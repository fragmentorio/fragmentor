import { isFragment, isReference } from "./types/index.js";
import type { FragmentShape, Schema, SchemaDocument } from "./types/index.js";
import { isIndex } from "../utils/object.js";

/** A new fragment of `schema`, every field at its default. */
export function initFragment<T extends Schema>({ schema }: { schema: Schema }): FragmentShape<T> {
  const result: Record<string, unknown> = { _type: schema._type };
  for (const [key, field] of Object.entries(schema.fields)) result[key] = field.default;
  return result as FragmentShape<T>;
}

/** A new document of `schema`: a fragment (see `initFragment`) with a fresh `_id`. */
export function initDocument<T extends SchemaDocument>({ schema }: { schema: Schema }): FragmentShape<T> {
  return { _id: crypto.randomUUID(), ...initFragment({ schema }) } as FragmentShape<T>;
}

/**
 * Collects every `{ _ref }` id reachable inside a value (document, fragment, array, or primitive),
 * by walking fragments/arrays at any depth.
 * @param value The value to walk (document, fragment, array, or primitive).
 * @returns The ids referenced, in encounter order, with duplicates possible.
 */
export function refs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refs);
  if (isReference(value)) return [value._ref];
  if (isFragment(value)) return Object.values(value).flatMap(refs);
  return [];
}

/**
 * Where a path points: an array item ("sections.1", `index` set) or a single field ("hero.media"), as the path of the
 * fragment holding it and the field's key.
 * @example locate(["sections", "1"]) // { parent: [], key: "sections", index: 1 }
 * @example locate(["hero", "media"]) // { parent: ["hero"], key: "media" }
 */
export function locate(path: string[]): { parent: string[]; key: string; index?: number } {
  const array = isIndex(path[path.length - 1]);
  return {
    parent: path.slice(0, array ? -2 : -1),
    key: path[path.length - (array ? 2 : 1)],
    ...(array ? { index: Number(path[path.length - 1]) } : {}),
  };
}
