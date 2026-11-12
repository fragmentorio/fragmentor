import jsep from "jsep";
import { evaluate } from "../../utils/expression.js";
import { read } from "../../build/source/index.js";
import { folder } from "../../utils/path.js";
import { initDocument } from "../../model/fragment.js";
import { getSchema } from "../../model/schema.js";
import { bytes } from "../../utils/text.js";
import { sha256 } from "../../utils/hash.js";
import type { Document, Schema, Source, Push } from "../../model/types/index.js";

/*
 * What `pull` and `push` share: the documents of a type, a spec's expressions and request templates, rendering a request from a scope,
 * the request loop `next` drives, and sending each request with timeouts, retries and size limits.
 */

/*
 * One request: the timeout of each attempt, how many times 429/5xx/network errors are retried, and the longest Retry-After honored.
 * Together at most 3 attempts × 15s + 2 waits × 10s ≈ 1 minute, the `LIMITS.seconds` cap is over a whole run.
 */
const TIMEOUT = 15_000;
const RETRIES = 2;
const MAX_WAIT = 60_000;

/**
 * Caps on one run (a pull, or one pushed item's requests), so a spec (or an API) that never ends, loops or floods is aborted instead of running for hours or filling memory.
 * pages, items: totals over the run. seconds: wall-clock time of the whole run, retries and their waits included (TIMEOUT and MAX_WAIT only bound one request).
 * bytes: one response body. url, body: one rendered request (the url and its JSON body), so a `next` can't grow the scope every page.
 * E.g. 100 pages of 50 items, each page under 5 MB, in 2 minutes.
 */
export type Limits = { pages: number; items: number; seconds: number; bytes: number; url: number; body: number };
export const LIMITS: Limits = { pages: 100, items: 5_000, seconds: 120, bytes: 5 * 2 ** 20, url: 2 * 2 ** 10, body: 256 * 2 ** 10 };

const PLACEHOLDER = /\{\{([\s\S]+?)\}\}/g;
const WHOLE = /^\{\{([\s\S]+?)\}\}$/;
/* Stands in for a placeholder while a url is split on "?", "&" and "=", which an expression may contain itself */
const MARK = /\u0000(\d+)\u0000/g;

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export type Request = { method: string; url: string; headers: Record<string, string>; body?: unknown };
export type Reply = { status: number; headers: Record<string, string>; body: unknown };
export type Scope = Record<string, unknown>;
/* An item, document or request that failed, by the path it maps to, with why */
export type Failure = { path: string; error: string };

/******************************/
/* SCOPE
/******************************/

/**
 * A document Source's values, read with its schema: the scope `pull` and `push` start from.
 * @returns null when the Source isn't a readable document of `_type`.
 * @example open(shirt, schemas, "product") // { _id: "abc123", _type: "product", handle: "shirt", title: "Shirt", ... }
 */
export function open(source: Source, schemas: Schema[], _type: string): Scope | null {
  if (folder(source.path) !== "documents") return null;
  try {
    const document = read.document({ source, schemas, errors: [] });
    return document?._type === _type ? { ...document } : null;
  } catch {
    return null;
  }
}

/** Every document of `_type` among `sources`, read leniently (see `open`), with the Source it was read from. */
export function documents(sources: Source[], schemas: Schema[], _type: string): { source: Source; document: Document }[] {
  return sources.flatMap((source) => {
    const document = open(source, schemas, _type);
    return document ? [{ source, document: document as Document }] : [];
  });
}

/* The values of the first document of type `context` (e.g. a settings singleton holding API keys), so they don't live in the schema. Falls back to the schema's defaults when that document is missing or unreadable */
export function context(spec: { context?: string }, schemas: Schema[], sources: Source[]): Scope {
  if (!spec.context) return {};
  const schema = getSchema({ schemas, type: spec.context });
  if (!schema) throw new Error(`context "${spec.context}" isn't a schema`);
  return documents(sources, schemas, spec.context)[0]?.document ?? initDocument({ schema });
}

/**
 * A schema's `pull` or `push` spec, checked before a single request is sent.
 * @throws When the schema has none, or one of its expressions doesn't parse (see `expressions`).
 */
export function spec<At extends "pull" | "push">(schema: Schema, at: At): NonNullable<Schema[At]> {
  const spec = schema[at];
  if (!spec) throw new Error(`Schema "${schema._type}" has no ${at}`);
  expressions(spec, at);
  return spec as NonNullable<Schema[At]>;
}

/* Every `{{expr}}` in a request template: url, header values and body strings at any depth */
export function placeholders(value: unknown): string[] {
  if (typeof value === "string") return [...value.matchAll(PLACEHOLDER)].map((m) => m[1]);
  if (value && typeof value === "object") return Object.values(value).flatMap(placeholders);
  return [];
}

/**
 * Checks that every expression of a pull or push spec parses: `select`, `init`, `next`, `map` and the request's placeholders.
 * @param at Names the spec in the error, "pull" or "push".
 * @throws On the first one that doesn't, before a single request is sent.
 */
export function expressions(spec: Push, at: string): void {
  const all: [string, string][] = [
    ...(spec.select ? [["select", spec.select] as [string, string]] : []),
    ...Object.entries(spec.init ?? {}).map(([k, e]): [string, string] => [`init.${k}`, e]),
    ...Object.entries(spec.next ?? {}).map(([k, e]): [string, string] => [`next.${k}`, e]),
    ...Object.entries(spec.map ?? {}).map(([k, e]): [string, string] => [`map.${k}`, e]),
    ...placeholders(spec.request).map((e): [string, string] => ["request", e]),
  ];
  for (const [key, expr] of all) {
    try {
      jsep(expr);
    } catch (e) {
      throw new Error(`Invalid expression in ${at}.${key} "${expr}": ${(e as Error).message}`);
    }
  }
}

/**
 * The scope for the next request: `next`'s expressions evaluated against `scope` plus `extra` (e.g. the last `response`), over `scope`.
 * @returns null to stop: when a `next` value is null or undefined, or nothing changed.
 */
export function advance(next: Record<string, string>, scope: Scope, extra: Scope): Scope | null {
  const values = all(next, { ...scope, ...extra });
  if (Object.values(values).some((v) => v == null)) return null;
  if (Object.entries(values).every(([k, v]) => JSON.stringify(v) === JSON.stringify(scope[k]))) return null;
  return { ...scope, ...values };
}

/******************************/
/* REQUEST
/******************************/

/**
 * Sends request after request for a spec: `init` over `scope` first, then `next` updates the scope each request is rendered from (with the last `response`), until a `next` value is null or nothing changed.
 * @param step Called with every response: returns more values for `next` to read (e.g. the page's `items`), or null to stop.
 * @param request Builds the request from the scope, the spec's rendered `request` by default.
 * @param unit Names one request in the errors, e.g. "page".
 * @param json false keeps a response body that isn't JSON as text (see `send`).
 * @throws When the loop looks abusive: over limits.pages requests, over limits.seconds in all, or a request that repeats an earlier one (a `next` that loops, of any length).
 */
export async function exchange({ spec, at, scope, fetch, step, request = (s) => render(spec.request, s), unit = "request", json, limits = LIMITS }: {
  spec: Push; at: "pull" | "push"; scope: Scope; fetch: Fetch; step: (response: Reply, scope: Scope) => Scope | null;
  request?: (scope: Scope) => Request; unit?: string; json?: boolean; limits?: Limits;
}): Promise<void> {
  let current: Scope = { ...scope, ...all(spec.init ?? {}, scope) };
  /* A digest of every request sent, to its number, so a loop of any length is caught (not only a `next` that repeats the last scope) */
  const sent = new Map<string, number>();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error(`Stopped after ${limits.seconds}s, the ${at} took too long`)), limits.seconds * 1000);
  try {
    for (let n = 0; ; n++) {
      deadline.signal.throwIfAborted();
      if (n === limits.pages) throw new Error(`Stopped after ${limits.pages} ${unit}s, ${at}.next may never end`);
      const rendered = request(current);
      const print = await sha256(JSON.stringify([rendered.method, rendered.url, rendered.body]));
      if (sent.has(print)) throw new Error(`${at}.next loops: ${unit} ${n + 1} repeats the request of ${unit} ${sent.get(print)! + 1}`);
      sent.set(print, n);

      const response = await send(rendered, fetch, { json, signal: deadline.signal, limits });
      const extra = step(response, current);
      const next = extra && spec.next && advance(spec.next, current, { response, ...extra });
      if (!next) return;
      current = next;
    }
  } finally {
    clearTimeout(timer);
  }
}

/* Evaluates every expression of a record against the same scope */
export function all(exprs: Record<string, string>, scope: Scope): Scope {
  return Object.fromEntries(Object.entries(exprs).map(([k, expr]) => [k, evaluate(expr, scope)]));
}

/**
 * Fills a template string's `{{expr}}` placeholders from `scope`. A string that is exactly one placeholder keeps the raw value (a number, an object, ...).
 * @returns undefined when any placeholder resolves to null or undefined, so the caller leaves that value out.
 * @example fill("Bearer {{key}}", { key: "abc" }) // "Bearer abc"
 */
function fill(text: string, scope: Scope, escape: (s: string) => string = (s) => s): unknown {
  const whole = text.match(WHOLE);
  if (whole) return evaluate(whole[1], scope) ?? undefined;
  let missing = false;
  const out = text.replace(PLACEHOLDER, (_, expr) => {
    const value = evaluate(expr, scope);
    if (value == null) missing = true;
    return value == null ? "" : escape(typeof value === "object" ? JSON.stringify(value) : String(value));
  });
  return missing ? undefined : out;
}

/* Builds the request for the current scope: values whose placeholders resolve to nothing are left out, and a body is sent as JSON */
export function render(request: Push["request"], scope: Scope): Request {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    const filled = fill(value, scope);
    if (filled !== undefined) headers[name.toLowerCase()] = String(filled);
  }
  const body = request.body === undefined ? undefined : prune(request.body, scope);
  if (body !== undefined) headers["content-type"] ??= "application/json";
  const method = request.method === undefined ? undefined : fill(request.method, scope);
  return { method: String(method ?? (body === undefined ? "GET" : "POST")).toUpperCase(), url: url(request.url, scope), headers, body };
}

/* Fills a body template at any depth, dropping keys and array items that resolve to nothing */
function prune(value: unknown, scope: Scope): unknown {
  if (typeof value === "string") return fill(value, scope);
  if (Array.isArray(value)) return value.map((v) => prune(v, scope)).filter((v) => v !== undefined);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, prune(v, scope)]).filter(([, v]) => v !== undefined));
  }
  return value;
}

/* Renders a url template: values are URL-encoded, a query param that resolves to nothing (or "") is dropped, an unresolved path is an error */
function url(template: string, scope: Scope): string {
  const exprs: string[] = [];
  const masked = template.replace(PLACEHOLDER, (_, expr) => `\u0000${exprs.push(expr) - 1}\u0000`);
  const unmask = (part: string, escape?: (s: string) => string) => fill(part.replace(MARK, (_, i) => `{{${exprs[Number(i)]}}}`), scope, escape);

  const q = masked.indexOf("?");
  const head = q === -1 ? masked : masked.slice(0, q);
  /* A url that is one placeholder is used as-is, e.g. a full next-page url from the response */
  const base = unmask(head, /^\u0000\d+\u0000$/.test(head) ? undefined : encodeURIComponent);
  if (base === undefined) throw new Error(`The request.url path has a placeholder that resolved to nothing`);

  const params = (q === -1 ? [] : masked.slice(q + 1).split("&")).flatMap((pair) => {
    const [k, v = ""] = pair.split(/=(.*)/s);
    const key = unmask(k, encodeURIComponent);
    const value = unmask(v, encodeURIComponent);
    return key === undefined || value === undefined || value === "" ? [] : [`${key}=${value}`];
  });

  const full = params.length ? `${base}${String(base).includes("?") ? "&" : "?"}${params.join("&")}` : String(base);
  let parsed: URL;
  try {
    parsed = new URL(full);
  } catch {
    throw new Error(`request.url didn't render to a valid url`);
  }
  if (parsed.protocol !== "https:") throw new Error(`request.url must be https, got "${parsed.protocol}"`);
  return parsed.toString();
}

export type Options = {
  /* false keeps a body that isn't JSON as text */
  json?: boolean;
  /* Aborts the request, its retries and their waits, e.g. a pull's deadline: the reason is thrown as-is */
  signal?: AbortSignal;
  limits?: Pick<Limits, "bytes" | "url" | "body">;
};

/*
 * Sends one request, retrying 429, 5xx and network errors with backoff. Errors name the method and url without its query, so keys never leak into logs.
 * A request over limits.url or limits.body isn't sent, and a response over limits.bytes is cut off, both errors.
 */
export async function send(request: Request, fetch: Fetch, { json = true, signal, limits = LIMITS }: Options = {}): Promise<Reply> {
  const { origin, pathname } = new URL(request.url);
  const label = `${request.method} ${origin}${pathname}`;
  const body = request.body === undefined ? undefined : JSON.stringify(request.body);
  if (request.url.length > limits.url) throw new Error(`${label} has a url over ${size(limits.url)}, a next may be growing it`);
  if (body !== undefined && bytes(body) > limits.body) throw new Error(`${label} has a body over ${size(limits.body)}, a next may be growing it`);

  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    let res: Response;
    try {
      const timeout = AbortSignal.timeout(TIMEOUT);
      res = await fetch(request.url, { method: request.method, headers: request.headers, body, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch (e) {
      signal?.throwIfAborted();
      /* fetch wraps the reason in `cause`. A target the egress proxy refused won't change on a retry */
      const cause = (e as { cause?: Error & { code?: string } }).cause;
      if (cause?.code !== "BLOCKED" && attempt < RETRIES) {
        await wait(backoff(attempt), signal);
        continue;
      }
      throw new Error(`${label} failed: ${cause?.message ?? (e as Error).message}`);
    }

    if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) {
      await res.body?.cancel().catch(() => {});
      await wait(after(res) ?? backoff(attempt), signal);
      continue;
    }
    let text: string;
    try {
      text = await capped(res, limits.bytes, label);
    } catch (e) {
      signal?.throwIfAborted();
      throw e;
    }
    if (!res.ok) throw new Error(`${label} responded ${res.status}: ${text.slice(0, 200)}`);
    try {
      return { status: res.status, headers: Object.fromEntries(res.headers), body: text ? JSON.parse(text) : null };
    } catch {
      if (!json) return { status: res.status, headers: Object.fromEntries(res.headers), body: text };
      throw new Error(`${label} didn't return JSON: ${text.slice(0, 200)}`);
    }
  }
}

/* A response's body as text, read as a stream and cancelled once it passes `max` bytes, so a huge response is never held in memory */
async function capped(res: Response, max: number, label: string): Promise<string> {
  const error = () => new Error(`${label} responded with more than ${size(max)}`);
  if (Number(res.headers.get("content-length")) > max) {
    await res.body?.cancel().catch(() => {});
    throw error();
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw error();
    }
    text += decoder.decode(value, { stream: true });
  }
}

/* Resolves after `ms`, or rejects with the signal's reason as soon as it aborts */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const stop = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal?.addEventListener("abort", stop, { once: true });
  });
}

/* 8 KB, 20 MB, ... */
function size(n: number): string {
  if (n >= 2 ** 20) return `${+(n / 2 ** 20).toFixed(1)} MB`;
  if (n >= 2 ** 10) return `${+(n / 2 ** 10).toFixed(1)} KB`;
  return `${n} bytes`;
}

/* 0.5s, 1s, 2s, ... */
function backoff(attempt: number): number {
  return 500 * 2 ** attempt;
}

/* A Retry-After header in seconds or as a date, in ms, capped at MAX_WAIT */
function after(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const ms = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
  return Number.isNaN(ms) ? null : Math.min(Math.max(ms, 0), MAX_WAIT);
}
