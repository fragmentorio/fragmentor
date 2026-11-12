import { patch, type Patch } from "./patch.js";
import * as read from "./read.js";
import type { Schema, Source } from "../../model/types/index.js";

/* A writer's options: the Source to change, the project's schemas to validate against, and the changes (see `patch`) */
export type Write = { source: Source; schemas?: Schema[] } & Patch;

/* What a writer checks its result with: a reader, run strictly (without `errors`) so it throws instead of fixing */
type Reader = (options: { source: Source; schemas?: Schema[] }) => unknown;

/* A writer mirrors its reader: it patches the Source, then returns it only if it reads back */
function writer(reader: Reader) {
  return ({ source, schemas, ...changes }: Write): Source => {
    const next = patch(source, changes);
    reader({ source: next, schemas });
    return next;
  };
}

/**
 * Writes changes to a schema Source (see `patch`), then reads it back strictly (see `read.schema`).
 * @throws When the changes can't be applied, or the result isn't a valid schema.
 */
export const schema = writer(read.schema);

/**
 * Writes changes to a document Source (see `patch`), then reads it back strictly against its schema (see `read.document`).
 * @throws When the changes can't be applied, or the result isn't a valid document.
 * @example write.document({ source, schemas, $set: { title: "Hello" } })
 */
export const document = writer(read.document);

/**
 * Writes changes to a component Source (see `patch`), then reads it back strictly (see `read.component`).
 * @throws When the changes can't be applied, or the result isn't a valid .html component.
 */
export const component = writer(read.component);

/**
 * Writes changes to an asset Source (see `patch`), then reads it back strictly (see `read.asset`).
 * @throws When the changes can't be applied, or the file isn't in /assets/.
 */
export const asset = writer(read.asset);
