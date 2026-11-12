import { evaluate } from "../../utils/expression.js";
import { LIMITS, context, documents, exchange, render, spec } from "../api/index.js";
import type { Failure, Fetch, Limits, Request, Scope } from "../api/index.js";
import { isRecord, list } from "../../utils/object.js";
import type { Push, Schema, Source } from "../../model/types/index.js";

/**
 * Sends documents to an external API with their schema's `push` spec, the opposite of `pull`: every document of the schema, or only `document`.
 * In each document, `select` picks the items (the document itself without it), and each item runs its own request loop, `map` building every request's body from the scope and `next` updating that scope until a stop condition is hit.
 * Requests already sent can't be undone, so a failed request doesn't throw: its document goes to `failed` and the next one is pushed. Nothing is written.
 * @param schema A schema with a `push` spec.
 * @param schemas The project's schemas, to read the documents and find the `push.context` schema.
 * @param sources The project's sources, to find the documents and the `push.context` document.
 * @param document The Source of one document of the schema to push, instead of all of them.
 * @param fetch Sends every request. The standard `fetch` works; pass a custom one to control network access or proxy requests.
 * @param limits Overrides some of the default LIMITS, which apply to each item's requests: a `next` that loops, never ends or takes too long fails that document.
 * @throws On an invalid spec, or a `document` that isn't one of the schema, before any request.
 * @example await push({ schema: contact, schemas, sources }) // { pushed: [{ path: "/documents/contact/a1.json", ... }], failed: [{ path: "/documents/contact/b2.json", error: "POST https://... responded 400: ..." }] }
 */
export async function push({ schema, schemas, sources, document, fetch, limits }: { schema: Schema; schemas: Schema[]; sources: Source[]; document?: Source; fetch: Fetch; limits?: Partial<Limits> }): Promise<{ pushed: Source[]; failed: Failure[] }> {
  const push = spec(schema, "push");
  const targets = documents(document ? [document] : sources, schemas, schema._type);
  if (document && !targets.length) throw new Error(`${document.path} isn't a "${schema._type}" document`);
  const ctx = context(push, schemas, sources);
  const pushed: Source[] = [];
  const failed: Failure[] = [];

  for (const { source, document: values } of targets) {
    try {
      const base = { ...ctx, ...values };
      /* Without `select` the item is the document's field values, not its system values (_id, _type, ...), as `pull` maps only fields */
      const fields = Object.fromEntries(Object.keys(schema.fields).filter((k) => values[k] !== undefined).map((k) => [k, values[k]]));
      for (const item of items(push, base, fields)) {
        await exchange({ spec: push, at: "push", scope: { ...base, ...item }, fetch, json: false, limits: { ...LIMITS, ...limits }, request: (scope) => request(push, scope, item), step: () => ({}) });
      }
      pushed.push(source);
    } catch (e) {
      failed.push({ path: source.path, error: (e as Error).message });
    }
  }
  return { pushed, failed };
}

/* The items `select` finds in the document (an array, one object, or nothing), the document's fields without a `select` */
function items(spec: Push, scope: Scope, document: Scope): Scope[] {
  if (!spec.select) return [document];
  return list(evaluate(spec.select, scope)).map((item, i) => {
    if (!isRecord(item)) throw new Error(`push.select item #${i} isn't an object`);
    return item;
  });
}

/******************************/
/* REQUEST
/******************************/

/* One item's request for the current scope, POST unless the spec says otherwise. A `request.body` template overrides `map`. A mapped body is set after rendering, so a value from the document is never read as a {{placeholder}} */
function request(spec: Push, scope: Scope, item: Scope): Request {
  const rendered = render({ ...spec.request, method: spec.request.method ?? "POST" }, scope);
  const request = { ...rendered, body: spec.request.body !== undefined ? rendered.body : spec.map ? body(spec.map, scope) : item };
  request.headers["content-type"] ??= "application/json";
  return request;
}

/* A body from `map`, key -> expression: dot keys build nested objects, a value that resolves to undefined is left out */
function body(map: Record<string, string>, scope: Scope): Scope {
  const out: Scope = {};
  for (const [path, expr] of Object.entries(map)) {
    const value = evaluate(expr, scope);
    if (value === undefined) continue;
    const keys = path.split(".");
    let at = out;
    for (const key of keys.slice(0, -1)) at = (at[key] = at[key] && typeof at[key] === "object" ? at[key] : {}) as Scope;
    at[keys[keys.length - 1]] = value;
  }
  return out;
}
