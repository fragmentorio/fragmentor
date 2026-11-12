import { Document, Fields, Resolve, Schema } from "../../model/types/index.js";
import { isFragment, isReference } from "../../model/types/index.js";
import { getSchema } from "../../model/schema.js";

/**
 * Resolves a document's references, replacing every `{ _ref }` with the document it points to (looked up by `_id` in
 * `references`). Unresolved refs are removed: a single reference becomes `null`, an entry in a references array is dropped.
 *
 * Every document is resolved once into a single shared object, and every reference to it points to that same object,
 * the page's own `_id` included. A loop (a page -> its menu -> the same page) is then two objects pointing at each other,
 * where copying each reference would nest forever. Loops used to be cut off instead, which dropped legitimate links, like
 * a menu linking to the page it's shown on. Templates only follow the paths they name, so they always end, and `render`
 * caps components that nest themselves through a loop (see MAX_DEPTH in build/compile/render.ts).
 * @param document The document to resolve, used as is (e.g. after `complete`) for its own shared object.
 * @param references The list of all documents, used to look up each `_ref`.
 * @returns The document with every `_ref` replaced by its resolved document.
 */
export function resolve({ document, references }: { document: Document; references: Document[]; errors?: string[]; warnings?: string[] }): Resolve<Document> {
  const byId = new Map(references.map(d => [d._id, d]));
  const resolved = new Map<string, Record<string, unknown>>();

  /* The object is registered before its fields are filled, so a reference back to it, at any depth, gets this same object */
  const link = (doc: Document): Record<string, unknown> => {
    const existing = resolved.get(doc._id);
    if (existing) return existing;
    const target: Record<string, unknown> = {};
    resolved.set(doc._id, target);
    for (const [key, value] of Object.entries(doc)) target[key] = walk(value);
    return target;
  };

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk).filter(item => item !== null);
    if (isReference(value)) {
      const found = byId.get(value._ref);
      return found ? link(found) : null;
    }
    if (isFragment(value)) return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, walk(v)]));
    return value;
  };

  return link(document) as Resolve<Document>;
}

/**
 * Walks a value against its field definitions, filling in any non-nullable `reference`/`references` field
 * left `null` with matching candidates from `references` (matching `field.allow` when set, capped at
 * `field.max` for `references`), so `resolve` has something to resolve. Fragments are walked recursively
 * using `schemas` to find their field definitions.
 * @param value The value to walk (document or fragment).
 * @param fields The field definitions for `value`.
 * @param schemas The list of all schemas, used for nested fragments.
 * @param references The candidate documents to fill non-nullable null references with.
 * @returns The value with eligible null references filled in.
 */
function completeProp(value: Record<string, unknown>, fields: Record<string, Fields>, schemas: Schema[], references: Document[]): Record<string, unknown> {
  const result: Record<string, unknown> = { ...value };
  for (const [key, field] of Object.entries(fields)) {
    const prop = result[key];
    if (field.type === "reference") {
      if (prop === null && !field.nullable) {
        const candidate = references.find(r => !field.allow.length || field.allow.includes(r._type));
        if (candidate) result[key] = { _ref: candidate._id };
      }
    } else if (field.type === "references") {
      if (prop === null && !field.nullable) {
        const candidates = references.filter(r => !field.allow.length || field.allow.includes(r._type));
        result[key] = (field.max !== undefined ? candidates.slice(0, field.max) : candidates).map(r => ({ _ref: r._id }));
      }
    } else if (field.type === "fragment" && isFragment(prop)) {
      const def = getSchema({ schemas, type: prop._type });
      if (def) result[key] = completeProp(prop, def.fields, schemas, references);
    } else if (field.type === "fragments" && Array.isArray(prop)) {
      result[key] = prop.map(item => {
        if (!isFragment(item)) return item;
        const def = getSchema({ schemas, type: item._type });
        return def ? completeProp(item, def.fields, schemas, references) : item;
      });
    }
  }
  return result;
}

/**
 * Fills in every non-nullable `reference`/`references` field left `null` on a document with matching
 * candidates from `references`, so the document validates and `resolve` has something to resolve. Meant to run before
 * `resolve` (or `validateDocument`), not as a replacement for either.
 * @param document The document to complete.
 * @param schemas The list of all schemas, used to look up field definitions.
 * @param references The candidate documents to fill non-nullable null references with.
 * @returns The document with eligible null references filled in.
 */
export function complete({ document, schemas, references }: { document: Document; schemas: Schema[]; references: Document[]; errors?: string[]; warnings?: string[] }): Document {
  const def = getSchema({ schemas, type: document._type });
  if (!def) return document;
  return completeProp(document, def.fields, schemas, references) as Document;
}
