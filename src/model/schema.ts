import type { Fields, Schema } from "./types/index.js";

/* Schema helpers: looking a schema up, and the values its fields start with */

/** The schema of `type` among `schemas`, or undefined. */
export function getSchema<S extends Schema>({ schemas, type }: { schemas: S[] | undefined, type: unknown }): S | undefined {
  return schemas?.find((s) => s._type === type);
}

/**
 * The folder a schema's documents are written under, from its `path`, without a trailing "/". "" without one.
 * @example base({ path: "/products/", ... }) // "/products"
 */
export function base(schema: Schema): string {
  return schema.path?.replace(/\/$/, "") ?? "";
}

/**
 * The empty value of a field's type: what a field holds when its `null` default isn't allowed (it isn't nullable), or when it's switched on in the editor.
 * @example empty({ type: "string", default: null, nullable: true }) // ""
 */
export function empty(field: Fields): unknown {
  if (field.type === "number") return 0;
  if (field.type === "boolean") return false;
  if (field.type === "date") return new Date().toISOString().split("T")[0];
  if (field.type === "datetime") return new Date().toISOString();
  if (field.type === "color") return "#000000";
  if (field.type === "option") return field.options[0]?.value ?? "";
  if (field.type === "text" || field.type === "richtext" || field.type === "fragments") return [];
  if (field.type === "image") return { _type: "img", src: "", alt: "" };
  if (field.type === "fragment") return { _type: field.allow[0] ?? "" };
  if (field.type === "reference" || field.type === "references") return null;
  return "";
}

/**
 * A document's key: the trimmed value of its schema's `key` field. Empty (`null`, its default, or `""`, e.g. cleared) means it has no key yet.
 * @returns null when the schema has no `key`, or the value is empty.
 * @example keyOf({ handle: " shirt " }, product) // "shirt"
 */
export function keyOf(values: Record<string, unknown>, schema: Schema): string | null {
  const value = schema.key ? values[schema.key] : null;
  return typeof value === "string" || typeof value === "number" ? String(value).trim() || null : null;
}
