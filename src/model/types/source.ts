import * as z from "zod";
import { PathSchema } from "./primitives.js";

/******************************/
/* SOURCE
/******************************/

export const SourceSchema = z.object({
  path: PathSchema,
  data: z.string().nullable(),
  size: z.number().int().min(0),
  raw: z.string().nullable(),
  updated_at: z.string().max(64),
  created_at: z.string().max(64),
});

export type Source = z.infer<typeof SourceSchema>;

/******************************/
/* ENTRY
/******************************/

export const EntryMetaSchema = z.object({
  _path: z.string(),
  _extension: z.string(),
  _hidden: z.boolean(),
  _data: z.string().nullable(),
  _size: z.number().int().min(0),
  _raw: z.string().nullable(),
  _updated_at: z.string().max(64),
  _created_at: z.string().max(64),
});

export const EntrySchema = EntryMetaSchema.catchall(z.unknown());

export type Entry = z.infer<typeof EntrySchema>;