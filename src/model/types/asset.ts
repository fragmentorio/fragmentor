import * as z from "zod";
import { EntryMetaSchema } from "./source.js";

export const AssetSchema = EntryMetaSchema;

export type Asset = z.infer<typeof AssetSchema>;