import * as z from "zod";
import { EntryMetaSchema } from "./source.js";
import { IdentifierSchema } from "./primitives.js";

export const ComponentSchema = EntryMetaSchema.extend({
  _data: z.string(),
  _type: IdentifierSchema, // ADDED
});

export type Component = z.infer<typeof ComponentSchema>;

export function isComponent(value: unknown): value is Component {
  return ComponentSchema.safeParse(value).success;
}
