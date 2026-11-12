import { encodeJson } from "./json.js";
import { encodeYaml } from "./yaml.js";
import { encodeMarkdown } from "./markdown.js";
import { encodeHtml } from "./html.js";
import { Entry, Source } from "../../model/types/index.js";
import { SOURCE_KEYS } from "../../model/entry.js";
import { bytes } from "../../utils/text.js";

/* The encoder of each extension that holds structured data. Any other file keeps its `_data`, see `encode`. A Map, so an extension like "constructor" can't reach Object.prototype */
const ENCODERS = new Map<string, (value: Record<string, unknown>) => string>([
  ["json", encodeJson],
  ["yaml", encodeYaml],
  ["yml", encodeYaml],
  ["md", encodeMarkdown],
  ["html", encodeHtml],
  ["htm", encodeHtml],
]);

/**
 * Serializes an entry's structured data based on its file extension, and returns a plain Source with the result written into `data`.
 * The entry's Source fields (`_path`, `_size`, ...) become the Source's own, everything else is written into `data`, other `_` keys like `_type` and `_id` included.
 * Leave out what the file shouldn't hold, e.g. a derived `_slug`.
 */
export function encode({ entry }: { entry: Entry; errors?: string[]; warnings?: string[] }): Source {
  const encoder = ENCODERS.get(entry._extension);
  const data = Object.fromEntries(Object.entries(entry).filter(([key]) => !SOURCE_KEYS.includes(key)));
  const text = encoder ? encoder(data) : entry._data;
  return { path: entry._path, data: text, size: text === null ? entry._size : bytes(text), raw: entry._raw, updated_at: entry._updated_at, created_at: entry._created_at };
}
