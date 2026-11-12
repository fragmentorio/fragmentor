import { applyEdits, modify } from "jsonc-parser";
import { isScalar, parseDocument, stringify, type Document } from "yaml";
import { encodeMarkdown } from "../encode/markdown.js";
import { FRONTMATTER } from "../decode/markdown.js";
import { lines, bytes } from "../../utils/text.js";
import { isIndex } from "../../utils/object.js";
import { parse } from "../../utils/path.js";
import type { Source } from "../../model/types/index.js";

export type Patch = {
  data?: string;
  $set?: Record<string, unknown>;
  $replace?: Record<string, string>;
};

/* Field keys must start with a letter or "_" (FieldKeySchema), so a key made of digits is always a line range */
const LINE = /^\d+(:\d+)?$/;

/**
 * Patches a Source's raw text and returns the new Source, in a fixed order. Nothing is validated, see `write` for that:
 * 1. `data` replaces the whole text.
 * 2. `$set` line keys ("12", "12:15") replace those lines, `null` deletes them (see `lines`).
 * 3. `$set` key paths ("features.1.title") set parsed fields (any JSON value) and write them back, keeping the rest of the file:
 *    JSON, YAML and markdown frontmatter are edited in place, so only the changed value's text moves. `null` deletes the path.
 *    A markdown body is only settable as a whole, via `children`, which re-encodes the body and keeps the frontmatter.
 * 4. `$replace` substitutes every occurrence of each literal `text -> replacement` in the raw text.
 * @throws On a binary file (null `data`) without new `data`, a malformed line range, an object or array set on a line range, a `$replace` text that isn't in the file, unparseable JSON/YAML, or a key path the file's format can't take (e.g. a markdown body).
 * @example patch(source, { $set: { "title": "Hello", "3": "new third line" }, $replace: { "colour": "color" } })
 */
export function patch(source: Source, { data, $set = {}, $replace = {} }: Patch): Source {
  let text = data ?? source.data;
  if (text === null) throw new Error("Binary files can't be edited as text");
  const byLine = Object.entries($set).filter(([key]) => LINE.test(key));
  const byPath = Object.entries($set).filter(([key]) => !LINE.test(key));

  if (byLine.some(([, value]) => value && typeof value === "object")) throw new Error("A line range takes text, use a field path to set an object or array");
  if (byLine.length) text = lines(text, Object.fromEntries(byLine.map(([key, value]) => [key, value === null ? null : String(value)])));
  if (byPath.length) text = set(parse(source.path).extension, text, Object.fromEntries(byPath));
  for (const [find, to] of Object.entries($replace)) {
    if (!find || !text.includes(find)) throw new Error(`Text to replace not found, copy it exactly from the file: "${find.slice(0, 80)}"`);
    text = text.split(find).join(to);
  }

  return { ...source, data: text, size: bytes(text) };
}

/* The formats key paths can be written back into, by extension. A Map, so an extension like "constructor" can't reach Object.prototype */
const SETTERS = new Map<string, (text: string, patch: Record<string, unknown>) => string>([["json", json], ["yaml", yaml], ["yml", yaml], ["md", md]]);

/* Writes key paths back into a file's text in its own format */
function set(extension: string, text: string, patch: Record<string, unknown>): string {
  const setter = SETTERS.get(extension);
  if (!setter) throw new Error(`Key paths aren't supported for .${extension} files, use line numbers or data instead`);
  return setter(text, patch);
}

/* Edits JSON in place, so its formatting survives. A digit key addresses an array index unless its parent is an object. Deleting an array item shifts later items down */
function json(text: string, patch: Record<string, unknown>): string {
  let out = text || "{}\n";
  JSON.parse(out);
  const indent = out.match(/^[ \t]+/m)?.[0] ?? "  ";
  const formattingOptions = { insertSpaces: indent[0] !== "\t", tabSize: indent.length, eol: out.includes("\r\n") ? "\r\n" : "\n" };
  for (const [path, value] of Object.entries(patch)) {
    let node = JSON.parse(out);
    const keys = path.split(".").map((key) => {
      const object = node && typeof node === "object" && !Array.isArray(node);
      node = node?.[key];
      return isIndex(key) && !object ? Number(key) : key;
    });
    out = applyEdits(out, modify(out, keys, value === null ? undefined : value, { formattingOptions }));
  }
  return out;
}

/* Edits YAML in place, so comments and key order survive, and an existing one-line value keeps its line's formatting too. Deleting an array item shifts later items down */
function yaml(text: string, patch: Record<string, unknown>): string {
  for (const [path, value] of Object.entries(patch)) {
    const doc = parseDocument(text);
    if (doc.errors.length) throw doc.errors[0];
    const keys = path.split(".").map((key) => (isIndex(key) ? Number(key) : key));
    const next = splice(text, doc, keys, value);
    if (next !== undefined) {
      text = next;
      continue;
    }
    if (value === null) doc.deleteIn(keys);
    else doc.setIn(keys, value && typeof value === "object" ? doc.createNode(value) : value);
    text = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
  }
  return text;
}

/* Swaps one scalar in the raw text, or returns undefined when the result wouldn't parse back to that value (e.g. an empty value, or a comma in a flow list) */
function splice(text: string, doc: Document, keys: (string | number)[], value: unknown): string | undefined {
  const node = doc.getIn(keys, true);
  if (value === null || value === undefined || typeof value === "object" || !isScalar(node) || !node.range || node.type?.startsWith("BLOCK")) return undefined;
  const quote = node.type === "QUOTE_SINGLE" || node.type === "QUOTE_DOUBLE" ? node.type : undefined;
  const scalar = stringify(value, { lineWidth: 0, ...(quote && { defaultStringType: quote }) }).trimEnd();
  const next = text.slice(0, node.range[0]) + scalar + text.slice(node.range[1]);
  const check = parseDocument(next);
  return !scalar.includes("\n") && !check.errors.length && check.getIn(keys) === value ? next : undefined;
}

/* Edits a markdown file's YAML frontmatter in place, and re-encodes the body only when `children` is set, keeping the blank lines before it */
function md(text: string, patch: Record<string, unknown>): string {
  const { children, ...fields } = patch;
  if (Object.keys(fields).some((key) => key.startsWith("children."))) throw new Error("A markdown body can't be edited by key path, use line numbers or set children as a whole instead");
  const match = text.match(FRONTMATTER);
  const body = match ? text.slice(match[0].length) : text;
  const edited = Object.keys(fields).length ? yaml(match?.[2] ?? "", fields).trimEnd() : undefined;
  const head = edited === undefined ? match?.[0] ?? "" : match ? match[1] + edited + match[3] : `---\n${edited}\n---\n`;
  return head + ("children" in patch ? body.match(/^\s*/)![0] + encodeMarkdown({ children }) : body);
}
