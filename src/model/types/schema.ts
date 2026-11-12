import * as z from "zod";
import { IdentifierSchema } from "./primitives.js";
import { EntryMetaSchema } from "./source.js";
import { FieldSchema, type Fields } from "./fields.js";

const RequestSchema = z.object({
  method: z.string().optional(),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.record(z.string(), z.any()).optional(),
});

const ApiSchema = z.object({
  request: RequestSchema,
  context: z.string().optional(),
  init: z.record(z.string(), z.string()).optional(),
  next: z.record(z.string(), z.string()).optional(),
  select: z.string().optional(),
  map: z.record(z.string(), z.string()).optional(),
});

export const PullSchema = ApiSchema.extend({
  prune: z.boolean().optional(),
});

export type Pull = z.infer<typeof PullSchema>;

export const PushSchema = ApiSchema;

export type Push = z.infer<typeof PushSchema>;

export const SchemaSchema = EntryMetaSchema.extend({
  _data: z.string(),
  _type: IdentifierSchema,
  label: z.string().optional(),
  description: z.string().optional(),
  path: z.string().optional(),
  document: z.boolean().optional(),
  singleton: z.boolean().optional(),
  fields: z.record(IdentifierSchema, FieldSchema),
  key: z.string().optional(),
  pull: PullSchema.optional(),
  push: PushSchema.optional(),
});

export type Schema<F extends Record<string, Fields> = Record<string, Fields>> = z.infer<typeof SchemaSchema> & {
  fields: F;
};

export type SchemaDocument<TFields extends Record<string, Fields> = Record<string, Fields>> = Omit<Schema<TFields>, "document" | "singleton"> & {
  document: true;
  singleton?: boolean;
}

export type SchemaFragment<TFields extends Record<string, Fields> = Record<string, Fields>> = Omit<Schema<TFields>, "document" | "singleton"> & { document?: false, singleton?: false; };

export function isSchema(value: unknown): value is Schema {
  return SchemaSchema.safeParse(value).success;
}
