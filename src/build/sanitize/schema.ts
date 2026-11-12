import { Entry, Schema, SchemaSchema } from "../../model/types/index.js";
import { type } from "../../utils/path.js";
import { error, safeParse } from "../../utils/report.js";
import { strip } from "../../model/entry.js";

/**
 * Turns a decoded schema Entry into a Schema, dropping anything that doesn't fit.
 * `_type` is derived from the file name ("/page.json" -> "page"). Any `_` key in the file is ignored, with a warning.
 * @param errors Collects errors instead of throwing, the result is then null.
 * @param warnings Collects warnings.
 */
export function sanitize({ entry, errors, warnings }: { entry: Entry; errors?: string[]; warnings?: string[] }): Schema | null {
  const { data, error: message } = safeParse(SchemaSchema, { ...strip(entry, [], warnings), _type: type(entry._path) });
  return message === null ? data as Schema : error(`Invalid schema: ${message}`, null, errors);
}
