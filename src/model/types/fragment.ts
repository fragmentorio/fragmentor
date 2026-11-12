import type { Fields, InferField } from "./fields.js";
import { isRecord } from "../../utils/object.js";

/******************************/
/* REFERENCE
/******************************/

export type Reference = { _ref: string };

export function isReference(value: unknown): value is Reference {
  return isRecord(value) && typeof value._ref === "string";
}

/******************************/
/* FRAGMENT
/******************************/

export type Fragment<T extends string = string> = { _type: T; [key: string]: unknown };

export function isFragment(value: unknown): value is Fragment {
  return isRecord(value) && typeof value._type === "string";
}

export function isFragments(value: unknown): value is Fragment[] {
  return Array.isArray(value) && value.every(isFragment);
}

export type FragmentShape<T, K extends string = string> = T extends { fields: infer TProps extends Record<string, Fields> }
  ? { _type: K; } & { [P in keyof TProps]: InferField<TProps[P]> }
  : never;

export type TextFragment = Fragment<"text"> & { text: string; bold?: boolean; italic?: boolean; underline?: boolean; code?: boolean };
export type LinkFragment = Fragment<"a"> & { href: string; children: Fragment[]; target?: string; rel?: string };
export type ImageFragment = Fragment<"img"> & { src: string; alt: string };
export type HeadingFragment = Fragment<"h1" | "h2" | "h3" | "h4" | "h5" | "h6"> & { children: (TextFragment | LinkFragment)[] };
export type ParagraphFragment = Fragment<"p"> & { children: (TextFragment | LinkFragment)[] };
export type ItemFragment = Fragment<"li"> & { children: (TextFragment | LinkFragment)[] };
export type ListFragment = Fragment<"ul" | "ol"> & { children: ItemFragment[] };

export type RichTextFragment = TextFragment | LinkFragment | ImageFragment | HeadingFragment | ParagraphFragment | ListFragment;

/** The built-in types a richtext field always takes, those of `RichTextFragment`: its `allow` only adds custom types. An "li" lives inside a "ul" or "ol", whose own field takes it. */
export const RICHTEXT_TYPES: readonly string[] = ["text", "a", "img", "h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol"] satisfies RichTextFragment["_type"][];

const HTML_TAGS = [
  "a", "abbr", "address", "area", "article", "aside", "audio",
  "b", "base", "bdi", "bdo", "blockquote", "body", "br", "button",
  "canvas", "caption", "cite", "code", "col", "colgroup",
  "data", "datalist", "dd", "del", "details", "dfn", "dialog", "div", "dl", "dt",
  "em", "embed",
  "fieldset", "figcaption", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hgroup", "hr", "html",
  "i", "iframe", "img", "input", "ins",
  "kbd",
  "label", "legend", "li", "link",
  "main", "map", "mark", "menu", "meta", "meter",
  "nav", "noscript",
  "object", "ol", "optgroup", "option", "output",
  "p", "picture", "pre", "progress",
  "q",
  "rp", "rt", "ruby",
  "s", "samp", "script", "search", "section", "select", "slot", "small", "source", "span", "strong", "style", "sub", "summary", "sup", "svg",
  "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead", "time", "title", "tr", "track",
  "u", "ul",
  "var", "video",
  "wbr",
] as const;

export const RESERVED_FRAGMENT_TYPES = ["text", ...HTML_TAGS] as const;

/** Whether a fragment type is reserved: "text" or an HTML tag, which only a built-in schema may name. */
export function isReserved(type: string): boolean {
  return (RESERVED_FRAGMENT_TYPES as readonly string[]).includes(type);
}
