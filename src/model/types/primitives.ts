import * as z from "zod";
import { bytes } from "../../utils/text.js";

// Identifier: letters, numbers and _, not starting with a number. Example: "my_field"
export const IdentifierSchema = z
  .string()
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Only letters, numbers and _ are allowed, and it can't start with a number");

// Date: YYYY-MM-DD. Example: "2026-11-12"
export const DateSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Invalid date. Example: "2026-11-12"');

// Datetime: ISO 8601, YYYY-MM-DDTHH:mm[:ss[.sss]][Z|±HH:mm]. Example: "2026-11-12T14:30:00Z"
export const DateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,9})?)?(Z|[+-]([01]\d|2[0-3]):?[0-5]\d)?$/,
    'Invalid datetime. Example: "2026-11-12T14:30:00Z"'
  );

// Email: name@domain.tld. Example: "jane@example.com"
export const EmailSchema = z
  .string()
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email. Example: "jane@example.com"');

// Color: hex, #RGB or #RRGGBB. Example: "#000000"
export const ColorSchema = z
  .string()
  .regex(/^#([0-9A-Fa-f]{3}){1,2}$/, 'Invalid color. Example: "#000000" or "#000"');

// Url: absolute or relative, no spaces, no javascript:/vbscript:/data:. Example: "https://example.com", "/foo"
const URL_SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const URL_UNSAFE_SCHEMES = ["javascript", "vbscript", "data"];
/* Character references a browser decodes in an attribute before reading the url: numeric ones (";" optional) and the named ones that spell a scheme's colon or whitespace */
const NAMED_REFS: Record<string, string> = { colon: ":", tab: "\t", newline: "\n" };
const CHAR_REF = /&(?:#x([0-9a-f]+);?|#(\d+);?|(colon|tab|newline);)/gi;

/**
 * Whether a url would run script or embed content when written into an attribute: a javascript:, vbscript: or data: scheme, also when spelled
 * with character references ("javascript&#58;...") or whitespace and control characters a browser strips ("java\tscript:...").
 * @example unsafeUrl("JavaScript:alert(1)") // true
 * @example unsafeUrl("/about#team") // false
 */
export function unsafeUrl(url: string): boolean {
  const decoded = url
    .replace(CHAR_REF, (_, hex, dec, name) => (name ? NAMED_REFS[name.toLowerCase()] : String.fromCodePoint(Math.min(parseInt(hex ?? dec, hex ? 16 : 10), 0x10ffff))))
    .replace(/[\s\u0000-\u001f\u007f]/g, "");
  return URL_UNSAFE_SCHEMES.includes(decoded.match(URL_SCHEME)?.[1].toLowerCase() ?? "");
}

export const UrlSchema = z
  .string()
  .regex(/^[^\s\u0000-\u001f\u007f]+$/, 'Invalid url. Example: "https://example.com", "/foo" or "mailto:jane@example.com" (no spaces)')
  .refine(s => !unsafeUrl(s), "javascript:, vbscript: and data: urls are not allowed");

// Slug: starts with /, no trailing slash, no segment starting with _. Example: "/foo/bar"
const SEGMENT = '[a-zA-Z0-9_\\-]+';
const FOLDER_SEGMENT = `(?!_)${SEGMENT}`;
export const SlugSchema = z
  .string()
  .regex(new RegExp(`^/(${FOLDER_SEGMENT}/?)*$`), 'Invalid slug. Example: "/", "/foo", "/foo/bar" (never trailing slash, no extension, no segment starting with "_")')
  .transform(s =>
    s === '/' ? '/' : s.replace(/\/+/g, '/').replace(/\/$/, '')
  );

// Path: a canonical source path, as `normalize` outputs it: leading "/", "/" separators, no empty, "." or ".." segments,
// no whitespace, backslashes, control or <>:"|?*#% characters, NFC unicode, segments up to 255 bytes. Example: "/documents/blog/hello.md"
export const PathSchema = z
  .string()
  .regex(/^(\/(?!\.\.?(\/|$))[^\s\\/\u0000-\u001f\u007f<>:"|?*#%]+)+$/, 'Invalid path. Example: "/documents/blog/hello.md" (leading "/", no empty, "." or ".." segments, no spaces)')
  .refine(s => s === s.normalize("NFC"), "Path must be NFC normalized")
  .refine(s => s.split("/").every(segment => bytes(segment) <= 255), "Path segment is too long (max 255 bytes)");
