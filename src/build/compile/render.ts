import { encodeHtml } from "../encode/html.js";
import { chain as ancestry } from "../../utils/path.js";
import { encodeAttrs, encodeTag } from "../encode/tag.js";
import { isFragment, isReserved } from "../../model/types/index.js";
import { list } from "../../utils/object.js";
import type { Component, Schema } from "../../model/types/index.js";
import { annotate, paths, pointers } from "./annotate.js";
import { extract } from "./assets.js";
import { apply } from "./directives.js";

/* The minimal DOM surface compile needs, met by both linkedom (server) and the browser's DOM, so core depends on neither */
export interface Root {
  querySelectorAll(selector: string): Iterable<Elem>;
}

export interface Elem extends Root {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  remove(): void;
  cloneNode(deep: boolean): Elem;
  replaceWith(...nodes: (Elem | string)[]): void;
  previousSibling: Sibling | null;
  nextSibling: Sibling | null;
  textContent: string | null;
  innerHTML: string;
  tagName: string;
  attributes: Iterable<{ name: string; value: string }>;
}

/* Any node next to an element, a text node (nodeType 3) included */
export interface Sibling {
  nodeType: number;
  textContent: string | null;
  remove(): void;
}

/* A parsed template that serializes back to HTML, `children` being its top-level elements (only stamped, see `pointers`) */
export interface Parsed extends Root {
  children: Iterable<Pick<Elem, "setAttribute">>;
  toString(): string;
}

/**
 * Parses HTML into a `Parsed` document, passed in by the caller so core never imports a DOM implementation.
 * @example const parse: Parser = (html) => parseHTML(html).document; // linkedom
 */
export type Parser = (html: string) => Parsed;

/* A rendered page: its HTML, and every style/script extracted along the way keyed by path ("/_styles/<hash>.css") */
export type Rendered = { html: string; assets: Record<string, string> };

/** Escapes text so it can't be read as markup. */
function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Whether `needle` occurs in `haystack` in order, not necessarily adjacent ("child, not necessarily direct"). */
function subsequence(needle: string[], haystack: string[]): boolean {
  let i = 0;
  for (const item of haystack) if (item === needle[i]) i++;
  return i === needle.length;
}

/**
 * Picks the component that renders `type` inside `ancestors` (the _types it's nested in, root first). A component's file
 * name lists the ancestors it requires before its type: "product.faq.html" renders a faq anywhere inside a product, and
 * among all matches the most specific one wins, so it beats a plain "faq.html" there.
 * @example lookup(components, "faq", ["page", "product"]) // product.faq.html, else faq.html, else undefined
 */
export function lookup(components: Component[], type: string, ancestors: string[]): Component | undefined {
  let best: Component | undefined;
  let depth = -1;
  for (const component of components) {
    const chain = ancestry(component._path);
    if (component._type !== type || chain.length <= depth || !subsequence(chain, ancestors)) continue;
    best = component;
    depth = chain.length;
  }
  return best;
}

/**
 * Renders a reserved fragment (p, a, h1, text, ...) that has no component, the way `encodeHtml` would: _type is the tag,
 * primitive props its attributes (empty ones dropped, e.g. a link's default target ""), and children are rendered through `render` so a custom fragment inside still finds its component.
 * Text is escaped, since unlike a template's x-bind, encodeHtml writes it as-is. The root element gets `point(fragment)`, the editor's pointers in dev (see `pointers`).
 */
function fallback(fragment: Record<string, unknown>, render: (fragment: Record<string, unknown>) => string | undefined, point: (fragment: Record<string, unknown>) => Record<string, string>): string {
  const { _type, children, ...rest } = fragment;
  /* Written into the HTML rather than stamped on a parsed copy: parsing every paragraph just for this was most of a dev build */
  const pointers = point(fragment);
  if (_type === "text") {
    const html = encodeHtml({ children: [{ ...fragment, text: escape(String(fragment.text ?? "")) }] });
    /* Its root is the outermost mark (<strong>, <em>, ...), plain text has no element to carry it */
    return html.replace(/^<(\w+)/, (_, tag) => `<${tag}${encodeAttrs(pointers)}`);
  }
  const props = Object.fromEntries(Object.entries(rest).filter(([key, value]) => !key.startsWith("_") && value !== "" && (value === null || typeof value !== "object")));
  const inner = list(children).map((child) => (isFragment(child) ? render(child) ?? "" : escape(String(child)))).join("");
  return encodeTag(String(_type), { ...pointers, ...props }, inner);
}

/**
 * How deep fragments may nest. Resolved references can point back up (see `resolve`), so a component that renders a
 * reference leading to itself (a product card rendering its recommendations as cards, ...) would recurse until the stack
 * overflows. Real pages nest a handful of levels, this only stops runaway loops.
 */
export const MAX_DEPTH = 32;

/* Each component's template after `annotate` (dev only) and `extract`, indexed by `Number(dev)`. Weak, so it's freed with the components of a compile */
const templates = [new WeakMap<Component, Rendered>(), new WeakMap<Component, Rendered>()];

/**
 * Renders a document (or any fragment) into HTML, recursively. For every fragment reached:
 * 1. Its component is looked up by _type and the _types it's nested in (see `lookup`).
 * 2. Without one, a reserved type falls back to its plain HTML tag (see `fallback`), any other type renders nothing.
 * 3. The component's `<style>`/`<script>` are extracted into content-hashed assets (see `extract`), once per component.
 * 4. Its directives are applied against the fragment (see `apply`), rendering nested fragments the same way. Every
 *    expression also sees `document` (the top-level value, usually a page) as `$`, so a nested fragment can read its values.
 * Past MAX_DEPTH levels a fragment renders as a `<!-- too deep -->` comment instead.
 * @param components The project's components (read.component).
 * @param parse Parses HTML: linkedom on the server, the native DOM in the browser.
 * @param options.dev Adds the editor's pointers: `x-src` on every template element, and on every fragment's root element its
 *   `x-path` (where it lives in `document`, see `paths`), plus `x-type`/`x-allow` when `schemas` describe its field (see `pointers`).
 * @param options.schemas The project's schemas, for `x-type`/`x-allow`.
 * @returns The HTML, or an `<!-- unresolved type -->` comment when the root has no component, and the extracted assets.
 */
export function render(document: Record<string, unknown>, components: Component[], parse: Parser, { dev = false, schemas }: { dev?: boolean; schemas?: Schema[] } = {}): Rendered {
  const assets: Record<string, string> = {};
  /* A fragment's path is looked up from where it lives, so it's right however the template reached it. One that's not in the document (built by an expression) has none */
  const found = dev ? paths(document) : null;
  const point = (fragment: Record<string, unknown>) => {
    const path = found?.get(fragment);
    return path ? pointers(document, path, schemas) : {};
  };
  const mark = (el: { setAttribute(name: string, value: string): void }, fragment: Record<string, unknown>) => {
    for (const [name, value] of Object.entries(point(fragment))) el.setAttribute(name, value);
  };

  const go = (fragment: Record<string, unknown>, ancestors: string[]): string | undefined => {
    const type = String(fragment._type);
    if (ancestors.length >= MAX_DEPTH) return `<!-- too deep: ${type} -->`;
    const component = lookup(components, type, ancestors);
    if (!component && !isReserved(type)) return undefined;
    const nested = (child: Record<string, unknown>) => go(child, [...ancestors, type]);

    if (!component) return fallback(fragment, nested, point);

    /* Cached since a component renders many times (every card in a list), and parsing is most of what rendering costs */
    const cache = templates[Number(dev)];
    let template = cache.get(component);
    if (!template) cache.set(component, (template = extract(dev ? annotate(component._data, type) : component._data, parse)));
    Object.assign(assets, template.assets);
    const parsed = parse(template.html);
    apply(parsed, fragment, nested, mark, document); /* the top-level value, `$` in every expression of every nested fragment */
    for (const el of parsed.children) mark(el, fragment);
    return parsed.toString();
  };

  return { html: go(document, []) ?? `<!-- unresolved type: ${String(document._type)} -->`, assets };
}
