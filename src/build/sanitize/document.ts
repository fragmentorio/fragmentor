import { Document, DocumentSchema, Entry } from "../../model/types/index.js";
import { slug } from "../../utils/path.js";
import { error, safeParse } from "../../utils/report.js";
import { strip } from "../../model/entry.js";

/**
 * Turns a decoded document Entry into a Document, dropping anything that doesn't fit.
 * - `_type` and `_id` are taken from the file and required: without them it's an error, the file isn't a document.
 * - `_slug` is derived from `_path` ("/blog/index.md" -> "/blog").
 * - Any other `_` key in the file is ignored, with a warning.
 * @param errors Collects errors instead of throwing, the result is then null.
 * @param warnings Collects warnings.
 */
export function sanitize({ entry, errors, warnings }: { entry: Entry; errors?: string[]; warnings?: string[] }): Document | null {
  if (typeof entry._type !== "string") return error(`_type: missing in ${entry._path}`, null, errors);
  if (typeof entry._id !== "string" || !entry._id) return error(`_id: missing in ${entry._path}`, null, errors);
  const { data, error: message } = safeParse(DocumentSchema, { ...strip(entry, ["_type", "_id"], warnings), _slug: slug(entry._path) });
  return message === null ? data as Document : error(`Invalid document: ${message}`, null, errors);
}
