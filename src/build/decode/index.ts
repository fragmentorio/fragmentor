import { decodeJson } from "./json.js";
import { decodeYaml } from "./yaml.js";
import { decodeMarkdown } from "./markdown.js";
import { decodeHtml } from "./html.js";
import { Entry, Source } from "../../model/types/index.js";
import { parse } from "../../utils/path.js";
import { SOURCE_KEYS, ignore } from "../../model/entry.js";

/* The decoder of each extension that holds structured data. Any other file is passed through, see `decode`. A Map, so an extension like "constructor" can't reach Object.prototype */
const DECODERS = new Map<string, (content: string) => Record<string, unknown>>([
  ["json", decodeJson],
  ["yaml", decodeYaml],
  ["yml", decodeYaml],
  ["md", decodeMarkdown],
  ["html", decodeHtml],
  ["htm", decodeHtml],
]);

/**
 * A Source's own fields as an Entry's "_" fields, with nothing decoded: `path` -> `_path`, `data` -> `_data`, ...
 * `_extension` and `_hidden` are derived from the path (see `parse`), only for easy access.
 * @example entry(source({ path: "documents/.hello.md", data: "# Hi" })) // { _path: "/documents/.hello.md", _extension: "md", _hidden: true, _data: "# Hi", ... }
 */
export function entry(source: Source): Entry {
  const { extension, hidden } = parse(source.path);
  return {
    _path: source.path,
    _extension: extension,
    _hidden: hidden,
    _data: source.data,
    _size: source.size,
    _raw: source.raw,
    _updated_at: source.updated_at,
    _created_at: source.created_at,
  };
}

/* The file's data with the Source's own `_` fields on top, warning about each one the file tried to set */
function overlay(data: Record<string, unknown>, source: Source, warnings?: string[]): Entry {
  for (const key of Object.keys(data)) if (SOURCE_KEYS.includes(key)) ignore(key, warnings);
  return { ...data, ...entry(source) };
}

/**
 * Parses a source's raw data based on its file extension, and returns an Entry: the source's fields (as `_` fields, see `entry`) plus whatever structured data was found, merged directly onto it. Unrecognized extensions and binary files (null `data`) return just the `_` fields.
 * Keys starting with "_" in the file are kept, except the Source's own `_` fields: a file can't change its `_path`, `_size`, ... (a warning each).
 * Which of the file's other `_` keys are used is up to `sanitize`.
 */
export function decode({ source, warnings }: { source: Source; errors?: string[]; warnings?: string[] }): Entry {
  const decoder = DECODERS.get(parse(source.path).extension);
  return source.data === null || !decoder ? entry(source) : overlay(decoder(source.data), source, warnings);
}

/**
 * The `_type` a file declares, decoded leniently: undefined for a file without one (plain data, a binary, another format) or one that can't be decoded.
 * @example declared(source({ path: "/documents/hello.yml", data: "_type: post\n" })) // "post"
 */
export function declared(source: Source): string | undefined {
  try {
    const { _type } = decode({ source, errors: [] });
    return typeof _type === "string" ? _type : undefined;
  } catch {
    return undefined;
  }
}
