import { EntryMetaSchema, type Entry } from "./types/source.js";
import { warning } from "../utils/report.js";

/** The `_` fields every Entry gets from its Source (see `entry`): `_path`, `_data`, `_size`, ... A file can never set them. */
export const SOURCE_KEYS = Object.keys(EntryMetaSchema.shape);

/** Warns that a file set `key`, which it may not, so it's ignored. Returns false, to filter it out. */
export function ignore(key: string, warnings?: string[]): false {
  return warning(`${key}: can't be set in the file, ignored`, false, warnings);
}

/**
 * Drops the `_` keys a file may not set, with a warning for each: every `_` key except `keep` and the Source's own fields (see `SOURCE_KEYS`).
 * @example strip({ ...entry, _type: "post", _slug: "/x" }, ["_type"], warnings) // without `_slug`, warns '_slug: can\'t be set in the file, ignored'
 */
export function strip(entry: Entry, keep: string[], warnings?: string[]): Entry {
  return Object.fromEntries(Object.entries(entry).filter(([key]) => !key.startsWith("_") || keep.includes(key) || SOURCE_KEYS.includes(key) || ignore(key, warnings))) as Entry;
}
