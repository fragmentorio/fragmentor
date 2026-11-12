import * as z from "zod";
import { EntryMetaSchema, type Entry } from "./source.js";
import type { Reference } from "./fragment.js";
import { IdentifierSchema } from "./primitives.js";

/******************************/
/* DOCUMENT
/******************************/

export const DocumentSchema = EntryMetaSchema.extend({
  _data: z.string(),
  _id: z.string(), // ADDED
  _type: IdentifierSchema, // ADDED
  _slug: z.string() // ADDED
}).catchall(z.unknown());

export type Document<T extends string = string> = z.infer<typeof DocumentSchema> & { _type: T };

export function isDocument(value: unknown): value is Document {
  return DocumentSchema.safeParse(value).success;
}

export type Resolve<T = Document> =
  T extends Reference ? Document :
  T extends (infer U)[] ? Resolve<U>[] :
  T extends object ? { [K in keyof T]: Resolve<T[K]> } :
  T;
