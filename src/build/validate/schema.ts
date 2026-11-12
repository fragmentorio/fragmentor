import { EmailSchema, Fields, FieldSchema, Fragment, Schema, isFragment, isFragments, isReserved, IdentifierSchema } from "../../model/types/index.js";
import { error, warning } from "../../utils/report.js";
import { empty } from "../../model/schema.js";
import { rejects } from "./document.js";

/**
 * Validates a single field value considering all schemas.
 * @param field The field to validate.
 * @param path The keys from the schema to this field, e.g. ["fields", "size"], to say where a problem is in its message.
 * @param errors Collects errors instead of throwing, invalid parts are then replaced with a sane value.
 * @param warnings Collects warnings.
 * @returns The validated field value.
 */
export function validateField<T extends Fields>({ field, path = [], errors, warnings }: { field: T; path?: string[]; errors?: string[]; warnings?: string[] }): T | null {
  /* Prefixes the message with where the field is, e.g. "fields.size: Field options cannot be empty" */
  const fail = <V>(message: string, value: V) => error(path.length ? `${path.join(".")}: ${message}` : message, value, errors);
  const validated = FieldSchema.safeParse(field);
  if (!validated.success) {
    return fail(`Invalid field definition: ${validated.error.message}`, null);
  }

  field = validated.data as T;

  if (field.default === undefined) {
    const nullable = field.nullable || field.type === "reference" || field.type === "references";
    (field as { default?: unknown }).default = nullable ? null : empty(field);
  }

  if (field.default === null && field.type !== "reference" && field.type !== "references") {
    if (field.nullable) return field;
    (field as { default?: unknown }).default = fail(`Field default can only be null when the field is nullable`, empty(field));
  }

  if ("min" in field && "max" in field && field.min !== undefined && field.max !== undefined && field.min > field.max) {
    field.min = fail(`Field min ${field.min} is greater than max ${field.max}`, field.max);
  }

  if (field.type === "string") {
    if (field.min && field.default!.length < field.min) {
      field.default = fail(`Field default length ${field.default!.length} is less than min ${field.min}`, field.default!.padEnd(field.min, " "));
    }
    if (field.max && field.default!.length > field.max) {
      field.default = fail(`Field default length ${field.default!.length} is greater than max ${field.max}`, field.default!.substring(0, field.max));
    }
  }
  else if (field.type === "email") {
    if (field.default && !EmailSchema.safeParse(field.default).success) {
      field.default = fail(`Field default "${field.default}" is not a valid email`, "");
    }
  }
  else if (field.type === "number") {
    if (field.min && field.default! < field.min) {
      field.default = fail(`Field default ${field.default} is less than min ${field.min}`, field.min);
    }
    if (field.max && field.default! > field.max) {
      field.default = fail(`Field default ${field.default} is greater than max ${field.max}`, field.max);
    }
  }
  else if (field.type === "option") {
    if (field.options.length === 0) {
      field.options = fail(`Field options cannot be empty`, [{ label: "", value: "" }]);
    }
    if (!field.options.some(o => o.value === field.default)) {
      field.default = fail(`Field default "${field.default}" is not in options (allowed: ${field.options.map(o => o.value).join(", ")})`, field.options[0]?.value ?? "");
    }
  }
  else if (field.type === "image" || field.type === "fragment") {
    const reason = isFragment(field.default) ? rejects(field, field.default._type) : "Expected a fragment";
    if (reason) (field as { default?: unknown }).default = fail(`Field default: ${reason}`, empty(field));
  }
  else if (field.type === "richtext" || field.type === "fragments") {
    let list: Fragment[] = isFragments(field.default) ? field.default : fail(`Field default must be a list of fragments`, []);
    const reason = (f: Fragment) => rejects(field, f._type);
    const first = list.map(reason).find(Boolean);
    if (first) list = fail(`Field default: ${first}`, list.filter((f) => !reason(f)));
    if (field.type === "fragments" && field.min && list.length < field.min) {
      list = fail(`Field default length ${list.length} is less than min ${field.min}`, [...list, ...Array.from({ length: field.min - list.length }, () => ({ _type: field.allow[0] ?? "" }))]);
    }
    if (field.max && list.length > field.max) {
      list = fail(`Field default length ${list.length} is greater than max ${field.max}`, list.slice(0, field.max));
    }
    (field as { default?: unknown }).default = list;
  }

  return field;
}

export function validateFields({ fields, errors, warnings }: { fields: Record<string, Fields>; errors?: string[]; warnings?: string[] }): Record<string, Fields> {
  const parsed: Record<string, Fields> = {};
  for (const [key, field] of Object.entries(fields)) {
    if (key.startsWith("_")) continue;
    const parsedField = validateField({ field, path: ["fields", key], errors, warnings });
    if (parsedField) {
      parsed[key] = parsedField;
    }
  }
  return parsed;
}

/**
 * Validates a schema: its type name (no HTML tag), its field definitions, its key, and that `pull.map` sets that key.
 * @param schemas Every schema it can name (built-ins included), to warn about an `allow` naming a type that doesn't exist, or a `pull.context`/`push.context` that isn't a singleton. Left out, that isn't checked.
 * @param errors Collects errors instead of throwing, invalid parts are then replaced with a sane value.
 * @param warnings Collects warnings.
 */
export function validate({ schema, schemas, errors, warnings }: { schema: Schema; schemas?: Schema[]; errors?: string[]; warnings?: string[] }): Schema | null {
  /* A type is named in fragments and component file names, and an HTML tag's name is taken by its built-in schema */
  const type = IdentifierSchema.safeParse(schema._type);
  if (!type.success) return error(`_type: "${schema._type}" ${type.error.issues[0].message.toLowerCase()}`, null, errors);
  if (isReserved(schema._type)) return error(`_type: "${schema._type}" is an HTML tag, which is reserved`, null, errors);

  const fields = validateFields({ fields: schema.fields, errors, warnings });

  /* Only warnings: a schema may name a type that's created right after it */
  if (schemas) {
    const known = (type: string) => schemas.some((s) => s._type === type);
    for (const [key, field] of Object.entries(fields)) for (const type of ("allow" in field && field.allow) || []) if (!known(type)) warning(`fields.${key}: Type "${type}" doesn't exist`, null, warnings);
    for (const [at, api] of Object.entries({ pull: schema.pull, push: schema.push })) {
      if (api?.context && !schemas.some((s) => s._type === api.context && s.singleton)) warning(`${at}.context: "${api.context}" isn't a singleton schema`, null, warnings);
    }
  }

  /* `key` names the field that identifies a document of the schema: unique, and fixed once set. It starts at null, meaning no key yet. An invalid key is dropped.
     Its field holds one plain value, which `pull` also names a new document's file after, so it can't contain "/" (which rules out a url) */
  const KEY_TYPES: Fields["type"][] = ["string", "number", "email"];
  let key = schema.key;
  if (key !== undefined) {
    const field = fields[key];
    if (!schema.document || schema.singleton) key = error(`key: only a document schema (not a singleton) can have a key`, undefined, errors);
    else if (!field) key = error(`key: "${key}" isn't a field`, undefined, errors);
    else if (!KEY_TYPES.includes(field.type)) key = error(`key: "${key}" must be a ${KEY_TYPES.join(", ")} field, not ${field.type}`, undefined, errors);
    else if (!field.nullable || !field.immutable || field.default !== null) key = error(`key: "${key}" must be nullable and immutable, with default null`, undefined, errors);
  }

  /* Pull matches items onto documents by key, so it throws on a map without it: said here already, before the first pull */
  if (key && schema.pull?.map && !Object.prototype.hasOwnProperty.call(schema.pull.map, key)) warning(`pull.map: must set the key "${key}"`, null, warnings);

  return { ...schema, fields, key };
}