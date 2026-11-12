import { EmailSchema, ColorSchema, UrlSchema, Fields, InferField, Schema, Document, Fragment, FragmentShape, SchemaFragment, isReference, RICHTEXT_TYPES } from "../../model/types/index.js";
import { error, warning } from "../../utils/report.js";
import { isRecord, kind } from "../../utils/object.js";
import { getSchema } from "../../model/schema.js";

/* Warns about every key of `raw` that `fields` doesn't define, as it's dropped from the result. Keys starting with "_" are metadata and always kept */
function unknown(raw: Record<string, unknown>, fields: Record<string, Fields>, path: string[], warnings?: string[]) {
  for (const key of Object.keys(raw)) if (!key.startsWith("_") && !(key in fields)) warning(`${[...path, key].join(".")}: Not in the schema, so it's ignored`, null, warnings);
}

/**
 * Why `field` doesn't take a fragment of `type`, or null when it does. Only fields that hold fragments have a rule, any other field takes any type.
 * - text: only "text".
 * - image: only "img".
 * - richtext: the built-in rich text types (see `RICHTEXT_TYPES`), plus the custom types its `allow` lists. Without `allow`, built-ins only.
 * - fragment, fragments: only the types its `allow` lists.
 * @example rejects({ type: "richtext", allow: ["faq"], ... }, "hero") // 'Fragment type "hero" is not allowed (allowed: text, a, img, ..., ol, faq)'
 */
export function rejects(field: Fields, type: string): string | null {
  const only = (allowed: readonly string[]) => (allowed.includes(type) ? null : `Fragment type "${type}" is not allowed (allowed: ${allowed.join(", ")})`);
  if (field.type === "text") return type === "text" ? null : `Expected a text fragment, got "${type}"`;
  if (field.type === "image") return type === "img" ? null : `Expected an image (img) fragment, got "${type}"`;
  if (field.type === "richtext") return only([...RICHTEXT_TYPES, ...(field.allow ?? [])]);
  if (field.type === "fragment" || field.type === "fragments") return only(field.allow);
  return null;
}

/**
 * Validates a single property value against its field definition, returning the validated value or the default if invalid.
 * @params value The value to validate.
 * @params field The field definition to validate against.
 * @params schemas The list of all schemas, used for nested fragments.
 * @params errors Collects errors instead of throwing, invalid values are then replaced with the default.
 * @params warnings Collects warnings.
 * @params reset If true, the default value will be returned regardless of the input value.
 * @params depth The current recursion depth, used to prevent excessively deep nesting.
 * @params path The keys from the document to this value, e.g. ["blocks", "2", "title"], to say where a problem is in its message.
 * @params types The chain of fragment `_type`s from the root to here, used to detect circular nesting.
 * @returns The validated property value.
 */
export function validateProp<T extends Fields>({ value, field, schemas, reset = false, depth = 0, path = [], types = [], errors, warnings }: { value: unknown; field: T; schemas: Schema[]; reset?: boolean; depth?: number; path?: string[]; types?: string[]; errors?: string[]; warnings?: string[] }): InferField<T> {
  /* Prefixes the message with where the value is, e.g. "blocks.2.title: Expected string, got number" */
  const fail = <V>(message: string, value: V, at = path) => error(at.length ? `${at.join(".")}: ${message}` : message, value, errors);

  /* Validates one fragment value at `at` against its own schema (keeping its `_` keys), `ok` wrapping the result. Anything wrong returns `fallback` */
  const fragment = <V>(item: unknown, at: string[], where: string, fallback: V, ok: (result: Record<string, unknown>) => V): V => {
    if (!isRecord(item)) return fail(`Expected object ${where}, got ${kind(item)}`, fallback, at);
    const type = item._type as string;
    const reason = rejects(field, type);
    if (reason) return fail(reason, fallback, at);
    if (types.includes(type)) return fail(`Circular reference: type "${type}" already appears in this path`, fallback, at);
    const def = getSchema({ schemas, type });
    if (!def) return fail(`No schema found for type "${type}"`, fallback, at);
    unknown(item, def.fields, at, warnings);
    return ok({ ...meta(item), ...props(item, def, schemas, { reset, depth: depth + 1, path: at, types: [...types, type], errors, warnings }) });
  };

  if (depth > 10) return fail(`Maximum parsing depth exceeded for field with value ${JSON.stringify(value)}`, field.default as InferField<T>);
  if (value === null) {
    if (field.nullable) return null as InferField<T>;
    if (field.type === "reference" || field.type === "references") return null as InferField<T>;
    return fail(`Field is not nullable but value was deleted`, field.default as InferField<T>);
  }
  const def_ = field.default as InferField<T>;
  if (reset) return def_;
  /* A missing nullable field is off: `write` deletes a key set to null, so this is how a toggled-off field reads back */
  if (value === undefined) return field.nullable ? null as InferField<T> : def_;

  /* An out-of-range min/max is kept when errors are collected (a draft the editor warns about), only strict checks like compile reject it */
  if (field.type === "string" || field.type === "email") {
    if (typeof value !== "string") return fail(`Expected string, got ${typeof value}`, def_);
    if (field.min !== undefined && value.length < field.min) return fail(`String length ${value.length} is below minimum ${field.min}`, value as InferField<T>);
    if (field.max !== undefined && value.length > field.max) return fail(`String length ${value.length} exceeds maximum ${field.max}`, value as InferField<T>);
    if (field.type === "email" && value !== "" && !EmailSchema.safeParse(value).success) return fail(`"${value}" is not a valid email`, def_);
    return value as InferField<T>;
  }
  else if (field.type === "number") {
    if (typeof value !== "number") return fail(`Expected number, got ${typeof value}`, def_);
    if (field.min !== undefined && value < field.min) return fail(`Number ${value} is below minimum ${field.min}`, value as InferField<T>);
    if (field.max !== undefined && value > field.max) return fail(`Number ${value} exceeds maximum ${field.max}`, value as InferField<T>);
    return value as InferField<T>;
  }
  else if (field.type === "boolean") {
    if (typeof value !== "boolean") return fail(`Expected boolean, got ${typeof value}`, def_);
    return value as InferField<T>;
  }
  else if (field.type === "option") {
    if (typeof value !== "string") return fail(`Expected string for option, got ${typeof value}`, def_);
    if (!field.options.some(o => o.value === value)) return fail(`"${value}" is not a valid option (allowed: ${field.options.map(o => o.value).join(", ")})`, def_);
    return value as InferField<T>;
  }
  else if (field.type === "reference") {
    if (!isReference(value)) return fail(`Expected a reference ({ _ref: string }) for reference field, got ${kind(value)}`, def_);
    return { _ref: value._ref } as InferField<T>;
  }
  else if (field.type === "references") {
    if (!Array.isArray(value)) return fail(`Expected array for references field, got ${typeof value}`, def_);
    return value.flatMap((item, i) => {
      if (!isReference(item)) return fail(`Expected a reference ({ _ref: string }) in references array, got ${kind(item)}`, [], [...path, String(i)]);
      return [{ _ref: item._ref }];
    }) as InferField<T>;
  }
  else if (field.type === "date" || field.type === "datetime") {
    if (typeof value !== "string") return fail(`Expected string for date, got ${typeof value}`, def_);
    if (isNaN(new Date(value).getTime())) return fail(`"${value}" is not a valid date`, def_);
    return value as InferField<T>;
  }
  else if (field.type === "color") {
    if (typeof value !== "string") return fail(`Expected string for color, got ${typeof value}`, def_);
    if (!ColorSchema.safeParse(value).success) return fail(`"${value}" is not a valid hex color`, def_);
    return value as InferField<T>;
  }
  else if (field.type === "url") {
    if (typeof value !== "string") return fail(`Expected string for url, got ${typeof value}`, def_);
    if (value !== "" && !UrlSchema.safeParse(value).success) return fail(`"${value}" is not a valid url`, def_);
    return value as InferField<T>;
  }
  else if (field.type === "image" || field.type === "fragment") {
    return fragment(value, path, `for ${field.type}`, def_, (result) => result as InferField<T>);
  }
  else if (field.type === "fragments" || field.type === "richtext" || field.type === "text") {
    if (!Array.isArray(value)) return fail(`Expected array for ${field.type}, got ${typeof value}`, def_);
    return value.flatMap((item, i) => fragment(item, [...path, String(i)], `in ${field.type} array`, [], (result) => [result])) as InferField<T>;
  }
  return fail(`Unknown field type "${(field as any).type}"`, def_);
}

/* The `_` keys of `raw`: metadata, kept as is */
function meta(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).filter(([key]) => key.startsWith("_")));
}

/* Each of the schema's fields in `raw`, validated (see `validateProp`) one level below `options.path`. Anything else in `raw` is left out */
function props(raw: Record<string, unknown>, schema: Schema, schemas: Schema[], { path = [], ...options }: { reset?: boolean; depth?: number; path?: string[]; types?: string[]; errors?: string[]; warnings?: string[] }): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.fields)) {
    result[key] = validateProp({ ...options, value: raw[key], field, schemas, path: [...path, key] });
  }
  return result;
}

/**
 * Validates a fragment against the schema of its `_type`: its `_` keys are kept, each field is validated (see `validateProp`) and anything else is dropped.
 * @param errors Collects errors instead of throwing, invalid values are then replaced with the default. Without a schema, the result is null.
 */
export function validateFragment<T extends SchemaFragment>({ fragment, schemas, errors, warnings }: { fragment: Fragment; schemas: Schema[]; errors?: string[]; warnings?: string[] }): FragmentShape<T> | null {
  const schema = getSchema({ schemas, type: fragment._type });
  if (!schema) return error(`No schema found for fragment type "${fragment._type}"`, null, errors);
  const raw = isRecord(fragment) ? fragment : {};
  return { _type: schema._type, ...meta(raw), ...props(raw, schema, schemas, { errors, warnings }) } as FragmentShape<T>;
}

/**
 * Validates a document against the schema of its `_type`: its Source and identity `_` fields are kept, each field is validated (see `validateProp`),
 * and anything else is dropped with a warning.
 * @param errors Collects errors instead of throwing, invalid values are then replaced with the default. Without a schema, the result is null.
 */
export function validate({ document, schemas, errors, warnings }: { document: Document; schemas: Schema[]; errors?: string[]; warnings?: string[] }): Document | null {
  const schema = getSchema({ schemas, type: document._type });
  if (!schema) return error(`No schema found for document type "${document._type}"`, null, errors);

  const { _id, _type, _slug, _path, _extension, _hidden, _data, _size, _raw, _created_at, _updated_at } = document;
  unknown(document, schema.fields, [], warnings);
  return { _id, _type, _slug, _path, _extension, _hidden, _data, _size, _raw, _created_at, _updated_at, ...props(document, schema, schemas, { errors, warnings }) };
}
