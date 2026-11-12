import { Asset, AssetSchema, Entry } from "../../model/types/index.js";
import { error, safeParse } from "../../utils/report.js";

/**
 * Turns an asset Entry into an Asset. Nothing is derived or taken from the file: `_data` is null for binary files, their bytes live in storage.
 * @param errors Collects errors instead of throwing, the result is then null.
 */
export function sanitize({ entry, errors }: { entry: Entry; errors?: string[]; warnings?: string[] }): Asset | null {
  const { data, error: message } = safeParse(AssetSchema, entry);
  return message === null ? data : error(`Invalid asset: ${message}`, null, errors);
}
