import { Fields, Source } from "../../model/types/index.js";
import { decodeMarkdown } from "../decode/markdown.js";
import { decodeHtml } from "../decode/html.js";
import { normalize, parse } from "../../utils/path.js";
import { bytes } from "../../utils/text.js";
import * as read from "./read.js";
import { FOLDERS } from "./folders.js";
import * as write from "./write.js";

/* The path helpers live in utils/path.ts, re-exported here as part of the source API */
export { parse, format, folder, inside, slug, path, type, chain } from "../../utils/path.js";

/**
 * Builds a Source from a file's `path` and raw `data`, with no filesystem access so it runs anywhere.
 * `path` goes through `normalize` first, so any input either becomes a canonical path or throws. It's kept whole:
 * the extension and hidden flag are derived from it when needed (see `parse`).
 * Any other Source field passed in is used as-is instead of being derived; fields left out are computed:
 * size defaults to the byte length of `data` (a binary file passes its real size with a null `data`). raw defaults to null.
 * updated_at/created_at default to now.
 * @throws When `path` can't be normalized (see `normalize`), or the extension isn't letters and numbers only.
 */
export function source(source: { path: string, data: string | null } & Partial<Source>): Source {
  const path = normalize(source.path);
  const { extension } = parse(path);
  if (!/^[a-z0-9]*$/.test(extension)) throw new Error(`Invalid extension "${extension}". Use letters and numbers only, e.g. "md".`);
  const now = new Date().toISOString();
  return {
    path,
    updated_at: source.updated_at ?? source.created_at ?? now,
    created_at: source.created_at ?? now,
    data: source.data,
    size: source.size ?? bytes(source.data ?? ""),
    raw: source.raw ?? null,
  };
}

/* The files allowed at a project's root, next to the folders (see `FOLDERS`). Read it through `allowed` */
const FILES = ["README.md", "INSTRUCTIONS.md", "SETUP.md", "MEMORY.md", "logo.png", "preview.png"];

/**
 * Whether a normalized path may exist in a project: one of the allowed root files, or a file inside an allowed folder with one of that folder's extensions (the same check the readers make).
 * @example allowed("/documents/blog/hello.yml") // true
 * @example allowed("/assets/tool.exe") // false, not an asset extension
 * @example allowed("/documents") // false, a file can't take a folder's name
 * @example allowed("/notes.txt") // false, not an allowed root file
 */
export function allowed(path: string): boolean {
  const [name, ...rest] = path.slice(1).split("/");
  if (!rest.length) return FILES.includes(name);
  return Object.hasOwn(FOLDERS, name) && (FOLDERS[name as keyof typeof FOLDERS] as string[]).includes(parse(path).extension);
}

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const TRUE: unknown[] = [true, 1, "true", "1", "on", "yes"];
const FALSE: unknown[] = [false, 0, "false", "0", "off", "no"];

/**
 * A value in its field's type, for posted forms (every value a string) and pulled API data. `undefined` means "leave it out", so the default (or current value) stays.
 * A value no rule fits is passed through as-is, so validation names the problem.
 * @example coerce("12", { type: "number", default: 0 }) // 12
 * @example coerce("# Hi", { type: "richtext", default: [] }) // [{ _type: "h1", children: [{ _type: "text", text: "Hi" }] }]
 */
export function coerce(value: unknown, field: Fields): unknown {
  const t = field.type;
  /* Missing: an unchecked checkbox is false, a missing text field is empty (so `min: 1` makes it required), anything else is left out */
  if (value === undefined) return t === "boolean" ? false : t === "string" || t === "email" ? "" : undefined;
  const v = typeof value === "string" ? value.trim() : value;

  /* Empty: "" stays "" in a text field. Otherwise "" and null are null when the field allows it, else left out */
  if (v === "" && (t === "string" || t === "email" || t === "url")) return v;
  if (v === null && (t === "reference" || t === "references")) return null;
  if (v === "" || v === null) return field.nullable ? null : undefined;

  /* Boolean: "true", "1", "on", "yes" and 1 are true, their opposites false */
  if (t === "boolean") return TRUE.includes(v) ? true : FALSE.includes(v) ? false : v;

  /* Number to string: ids, SKUs, zip codes and option values often arrive as numbers */
  if (typeof v === "number" && (t === "string" || t === "url" || t === "option")) return String(v);

  /* String to number: plain numeric strings only, never "1,200", "$12" or "12px" */
  if (t === "number" && typeof v === "string") return NUMERIC.test(v) ? Number(v) : v;

  /* Date: ISO strings are kept as written (a date is cut to YYYY-MM-DD), a unix timestamp (seconds below 1e12, else ms) or any other parseable string becomes ISO */
  if ((t === "date" || t === "datetime") && (typeof v === "string" || typeof v === "number")) {
    if (typeof v === "string" && ISO_DATE.test(v)) return t === "date" ? v.slice(0, 10) : v;
    const d = new Date(typeof v === "number" && v < 1e12 ? v * 1000 : v);
    if (Number.isNaN(d.getTime())) return v;
    return t === "date" ? d.toISOString().slice(0, 10) : d.toISOString();
  }

  /* String to a single text run */
  if (t === "text" && typeof v === "string") return [{ _type: "text", text: v }];

  /* String to rich text: HTML when it starts with a tag, markdown otherwise (plain text becomes a paragraph) */
  if (t === "richtext" && typeof v === "string") return (/^<[a-z]/i.test(v) ? decodeHtml(v) : decodeMarkdown(v)).children ?? [];

  /* Url string to image */
  if (t === "image" && typeof v === "string") return { _type: "img", src: v, alt: "" };

  return v;
}

export { read, write };
export { patch } from "./patch.js";
