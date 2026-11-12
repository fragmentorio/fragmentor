import { evaluate } from "../../utils/expression.js";
import { declared, entry } from "../../build/decode/index.js";
import { encode } from "../../build/encode/index.js";
import { source as build, write, coerce } from "../../build/source/index.js";
import { normalize, parse } from "../../utils/path.js";
import { initDocument } from "../../model/fragment.js";
import { base, keyOf, getSchema } from "../../model/schema.js";
import { isRecord, list } from "../../utils/object.js";
import { LIMITS, all, context, documents, exchange, open, spec as verified, type Failure, type Fetch, type Limits, type Scope } from "../api/index.js";
import type { Entry, Fields, Schema, Source, Pull } from "../../model/types/index.js";

/**
 * Pulls every item a schema's `pull` spec selects from its API, page by page, and maps each onto a document file:
 * the document with the same value in the schema's `key` field is updated in place wherever it lives, otherwise a new .yml file named after that key is created.
 * Nothing is written: the created or changed Sources are returned in `pulled` for the caller to save, unchanged files left out.
 * Unless `pull.prune` is false, the documents with a key the API no longer returns are returned in `pruned`, for the caller to delete. An empty pull never prunes.
 * An item that can't be written (a bad key, a key held by two files, values that fail validation) is skipped and returned in `failed`, with the path it maps to (or `#index` without one); the others are still pulled.
 * Items are matched onto documents by the schema's `key` field. With a `document`, only that document is pulled: its values join the scope (so a request can target it, e.g. `{{handle}}`), only the item with its key is kept, and nothing is pruned.
 * @param schema A document schema with a `pull` spec.
 * @param schemas The project's schemas, to validate each file against.
 * @param sources The project's sources, to find the files that already exist.
 * @param document The Source of one document of the schema to pull, instead of all of them. It needs a key, unless the schema is a singleton.
 * @param fetch Sends every request. The standard `fetch` works; pass a custom one to control network access or proxy requests.
 * @param limits Overrides some of the default LIMITS. Set by the caller, not the schema, since the schema's author is who they guard against.
 * @throws On an invalid spec (before any request), a failed request, a `document` that isn't one of the schema, has no key or is missing from the response,
 *   or a pull that looks abusive: over a limit, a request that repeats an earlier one (a `next` that loops), or a page that repeats the one before (an API ignoring `next`).
 *   Nothing is returned then, since pruning a cut-off list would delete documents the API still has.
 * @example await pull({ schema: product, schemas, sources }) // { pulled: [{ path: "/documents/products/shirt.yml", data: "...", ... }], pruned: [{ path: "/documents/products/old.yml", ... }], failed: [{ path: "/documents/products/hat", error: "matches more than one file: ..." }] }
 * @example await pull({ schema: product, schemas, sources, document: shirt }) // { pulled: [{ path: "/documents/products/shirt.yml", ... }], pruned: [], failed: [] }
 */
export async function pull({ schema, schemas, sources, document, fetch, limits }: { schema: Schema; schemas: Schema[]; sources: Source[]; document?: Source; fetch: Fetch; limits?: Partial<Limits> }): Promise<{ pulled: Source[]; pruned: Source[]; failed: Failure[] }> {
  const spec = verify(schema);
  const current = document && open(document, schemas, schema._type);
  if (document && !current) throw new Error(`${document.path} isn't a "${schema._type}" document`);
  const key = current && keyOf(current, schema);
  if (current && !schema.singleton && !key) throw new Error(`${document!.path} has no ${schema.key}, so it can't be pulled`);
  const items = await pages(spec, { ...context(spec, schemas, sources), ...current }, fetch, { ...LIMITS, ...limits });
  if (!current || schema.singleton) return upsert(items, schema, schemas, sources, !current);

  const kept = items.filter((item) => isRecord(item) && keyOf(values(item, schema), schema) === key);
  if (!kept.length) throw new Error(`${schema.key} "${key}" isn't in the response`);
  return upsert(kept, schema, schemas, sources, false);
}

/******************************/
/* SPEC
/******************************/

/* Throws on anything that would only fail halfway through a run, before a single request is sent */
function verify(schema: Schema): Pull {
  const spec = verified(schema, "pull");
  if (!schema.document) throw new Error(`Schema "${schema._type}" must be a document to pull`);
  if (!schema.singleton && !schema.key) throw new Error(`Schema "${schema._type}" needs a key to match items onto documents`);
  if (!schema.singleton && spec.map && !Object.prototype.hasOwnProperty.call(spec.map, schema.key!)) throw new Error(`pull.map must set the key "${schema.key}"`);
  for (const key of Object.keys(spec.map ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(schema.fields, key.split(".")[0])) throw new Error(`pull.map.${key} isn't a field of "${schema._type}"`);
  }
  return spec;
}

/******************************/
/* FETCH
/******************************/

/* Fetches page after page (see `exchange`) and collects the items `select` finds in each, until a page has none. Throws when a page repeats the one before (an API ignoring `next`) or there are too many items */
async function pages(spec: Pull, scope: Scope, fetch: Fetch, limits: Limits): Promise<unknown[]> {
  const select = spec.select ?? "response.body";
  const items: unknown[] = [];
  let previous: string | undefined;
  let page = 0;
  await exchange({ spec, at: "pull", scope, fetch, limits, unit: "page", step: (response, scope) => {
    page++;
    const selected = evaluate(select, { ...scope, response });
    if (selected === undefined && page === 1) throw new Error(`pull.select "${select}" found nothing in the response`);
    const found = list(selected);
    if (!found.length) return null;
    /* An API that ignores the page or cursor param answers every request with the first page */
    const content = JSON.stringify(found);
    if (content === previous) throw new Error(`Page ${page} returned the same items as page ${page - 1}, the API may ignore pull.next`);
    previous = content;
    items.push(...found);
    if (items.length > limits.items) throw new Error(`Stopped after ${limits.items} items, the pull is too large`);
    return { items: found };
  } });
  return items;
}

/******************************/
/* UPSERT
/******************************/

/* Maps every item onto its document file. An item that fails is skipped and collected in `failed`, the rest are still written. `prune` false deletes nothing, e.g. when pulling one document */
function upsert(items: unknown[], schema: Schema, schemas: Schema[], sources: Source[], prune: boolean): { pulled: Source[]; pruned: Source[]; failed: Failure[] } {
  if (schema.singleton && items.length > 1) throw new Error(`Singleton "${schema._type}" received ${items.length} items, pull.select should give one`);
  const dir = base(schema);
  const found = documents(sources, schemas, schema._type);
  const typed = found.map(({ source }) => source);
  /* Every document of the schema with a key, by path, to that key */
  const keys = new Map(found.flatMap(({ source, document }): [string, string][] => {
    const key = keyOf(document, schema);
    return key ? [[source.path, key]] : [];
  }));
  const seen = new Set<string>();
  const ids = new Set<string>();
  const failed: Failure[] = [];
  const out: Source[] = [];

  items.forEach((item, i) => {
    let label = `#${i}`;
    try {
      if (!isRecord(item)) throw new Error("isn't an object");
      const data = values(item, schema, schemas);
      const id = schema.singleton ? "" : name(data[schema.key!], schema.key!);
      const stem = normalize(schema.singleton ? `/documents${dir || "/index"}` : `/documents${dir}/${id}`);
      label = stem;
      ids.add(id);
      if (seen.has(stem)) throw new Error("has the same key as an earlier item");
      seen.add(stem);
      const result = upsertOne(stem, id, data, schema, schemas, sources, typed, keys);
      if (result) out.push(result);
    } catch (e) {
      failed.push({ path: label, error: (e as Error).message });
    }
  });

  /* Pulled documents whose key the API no longer returns. A failed item's key still counts as returned, so its document stays. An empty pull deletes nothing: a broken API is likelier than an emptied one */
  const pruned = prune && schema.pull!.prune !== false && !schema.singleton && items.length > 0 ? sources.filter((s) => keys.has(s.path) && !ids.has(keys.get(s.path)!)) : [];
  return { pulled: out, pruned, failed };
}

/* An item's key (the value of the schema's `key` field `at`), also the file name of a new document: a non-empty string or number, without "/" */
function name(key: unknown, at: string): string {
  if (typeof key !== "string" && typeof key !== "number") throw new Error(`${at} resolved to ${key == null ? "nothing" : typeof key}`);
  const text = String(key).trim();
  if (!text) throw new Error(`${at} resolved to an empty string`);
  if (text.includes("/")) throw new Error(`${at} "${text}" contains "/", map a part of it, e.g. id.split("/").pop()`);
  return text;
}

/* An item's field values by key path: `map` when given (dot keys are nested paths), otherwise the item's own keys that are schema fields. Top-level values are coerced into their field's type (fragments at any depth, see `nest`), dot paths and null (which deletes the field) are set as-is */
function values(item: Scope, schema: Schema, schemas: Schema[] = []): Scope {
  const map = schema.pull!.map;
  const flat = map ? all(map, item) : Object.fromEntries(Object.keys(schema.fields).map((k) => [k, item[k]]));
  return Object.fromEntries(Object.entries(flat).flatMap(([k, v]) => {
    const out = v === undefined || v === null || k.includes(".") ? v : nest(coerce(v, schema.fields[k]), schema.fields[k], schemas);
    return out === undefined ? [] : [[k, out]];
  }));
}

/**
 * Turns a raw API value into a `fragment` or `fragments` field's value, at any depth: an object without `_type` gets the field's only allowed type,
 * and its fields are coerced into their types while keys that aren't fields are dropped (system keys like `_id` are kept). Other values are returned as-is, for validation to judge.
 * @example nest([{ sku: "S", price: "9.5", id: 7 }], { type: "fragments", allow: ["variant"], ... }, schemas) // [{ _type: "variant", sku: "S", price: 9.5 }]
 */
function nest(value: unknown, field: Fields, schemas: Schema[]): unknown {
  if (field.type !== "fragment" && field.type !== "fragments") return value;
  const one = (v: unknown): unknown => {
    if (!isRecord(v)) return v;
    /* First, so it leads the YAML. An undefined _type is dropped below */
    const fragment: Scope = { _type: field.allow.length === 1 ? field.allow[0] : undefined, ...v };
    const schema = getSchema({ schemas, type: fragment._type });
    if (!schema) return fragment;
    return Object.fromEntries(Object.entries(fragment).flatMap(([k, x]) => {
      const f = schema.fields[k];
      const out = k.startsWith("_") ? x : f ? nest(coerce(x, f), f, schemas) : undefined;
      return out === undefined ? [] : [[k, out]];
    }));
  };
  return field.type === "fragments" && Array.isArray(value) ? value.map(one) : one(value);
}

/* Updates the document whose key is `id`, wherever it lives (singletons: the document of that type, among `typed`), or creates it at `stem`. null when nothing changed */
function upsertOne(stem: string, id: string, data: Scope, schema: Schema, schemas: Schema[], sources: Source[], typed: Source[], keys: Map<string, string>): Source | null {
  const matches = schema.singleton ? typed : sources.filter((s) => keys.get(s.path) === id);
  /* A file without a key yet (e.g. created in the editor) is still found at its path, and gets the key */
  const existing = matches.length ? matches : sources.filter((s) => parse(s.path).path === stem);
  if (existing.length > 1) throw new Error(`matches more than one file: ${existing.map((s) => s.path).join(", ")}`);
  if (!matches.length && existing.length && keys.has(existing[0].path)) throw new Error(`${existing[0].path} is taken by key "${keys.get(existing[0].path)}"`);

  if (existing.length) {
    const current = declared(existing[0]);
    if (current !== schema._type) throw new Error(`${existing[0].path} is a "${current ?? "plain data"}" file, not "${schema._type}"`);
    /* Key paths set only what was mapped, so "cover.src" keeps the rest of an existing cover */
    const next = write.document({ source: existing[0], schemas, $set: data });
    return next.data === existing[0].data ? null : next;
  }

  /* A new file starts from the schema's defaults, like a document created in the editor, then gets the same key paths without nulls so defaults stay */
  const fresh = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null));
  const defaults = encode({ entry: { ...entry(build({ path: `${stem}.yml`, data: "" })), ...(initDocument({ schema }) as Record<string, unknown>) } as Entry });
  return write.document({ source: defaults, schemas, $set: fresh });
}
