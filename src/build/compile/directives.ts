import { isFragment, unsafeUrl } from "../../model/types/index.js";
import { evaluate } from "../../utils/expression.js";
import type { Elem, Root } from "./render.js";

/* The expression evaluator lives in utils/expression.ts (pull and push use it too), re-exported here where it started */
export { evaluate };

/* Attributes a browser loads or navigates to, so a bound value with a javascript:, vbscript: or data: url is dropped from them (see `unsafeUrl`), whatever the field's type */
const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "xlink:href", "poster", "cite", "background"]);

/**
 * Applies a template's directives to `root` in place, in this order:
 * 1. `x-for` rescopes an element to the value: an array repeats it once per item, any other non-null value is its new scope.
 * 2. `x-if` removes the element when falsy.
 * 3. `x-bind` sets the element's text, or renders a fragment (or array of fragments) value through `render` into it.
 * 4. `x-bind:attr` sets an attribute, removing it when the value is null or undefined, or an unsafe url in a url attribute (href, src, ..., see `unsafeUrl`).
 * A `<template>`'s contents get the same directives and data (applied right after `x-for`, see below).
 * @param render Renders a nested fragment (see render.ts).
 * @param mark Marks a fragment's root element with the editor's pointers (a no-op outside dev, see `pointers`).
 * @param top The top-level value being rendered, `$` in every expression (see `evaluate`). Defaults to `data`, which is the top level when called from it.
 */
export function apply(
  root: Root,
  data: Record<string, unknown>,
  render: (fragment: Record<string, unknown>) => string | undefined,
  mark: (el: { setAttribute(name: string, value: string): void }, fragment: Record<string, unknown>) => void,
  top: Record<string, unknown> = data
): void {
  for (const el of root.querySelectorAll("[x-for]")) {
    const expr = el.getAttribute("x-for")!;
    el.removeAttribute("x-for");
    /* x-bind on the same element wins */
    if (el.getAttribute("x-bind") != null) continue;
    const items = evaluate(expr, data, top);
    if (Array.isArray(items)) {
      /* Every clone after the first gets the whitespace before the original, so items keep the template's indentation */
      const before = el.previousSibling;
      const indent = before?.nodeType === 3 && !before.textContent?.trim() ? before.textContent ?? "" : "";
      el.replaceWith(...items.flatMap((item, i) => {
        const clone = el.cloneNode(true);
        if (isFragment(item)) mark(clone, item);
        /* The repeated element's own x-bind:attr reads the item, like its children do (querySelectorAll never matches the root itself) */
        bind(clone, item as Record<string, unknown>, top);
        apply(clone, item as Record<string, unknown>, render, mark, top);
        return i && indent ? [indent, clone] : [clone];
      }));
    } else if (items != null) {
      bind(el, items as Record<string, unknown>, top);
      apply(el, items as Record<string, unknown>, render, mark, top);
    }
  }

  /*
   * A <template>'s markup is authored like the rest of the component (e.g. a line a script clones per basket item), so its
   * directives get the same data. Queries from outside never reach template content, so each template is applied on its own.
   * Parsers keep that content in different places: linkedom (server) as the template's own children, with `.content` only
   * a copy whose changes are never serialized, the browser only in `.content`. Hence the children when there are any.
   * Runs after x-for, so a template inside a repeated element is applied with that item's data first.
   */
  for (const el of root.querySelectorAll("template")) {
    const template = el as Elem & { content?: Root; firstElementChild?: unknown };
    const content = template.firstElementChild ? template : template.content;
    if (content) apply(content, data, render, mark, top);
  }

  for (const el of root.querySelectorAll("[x-if]")) {
    if (evaluate(el.getAttribute("x-if")!, data, top)) el.removeAttribute("x-if");
    else el.remove();
  }

  for (const el of root.querySelectorAll("[x-bind]")) {
    const expr = el.getAttribute("x-bind")!;
    const value = evaluate(expr, data, top);
    const unresolved = (f: Record<string, unknown>) => `<!-- unresolved type: ${f._type} -->`;
    if (isFragment(value)) el.innerHTML = render(value) ?? unresolved(value);
    else if (Array.isArray(value) && value.every(isFragment)) el.innerHTML = value.map((v) => render(v) ?? unresolved(v)).join("");
    else el.textContent = value == null ? "" : String(value);
    el.removeAttribute("x-bind");
  }

  for (const el of root.querySelectorAll("*")) bind(el, data, top);
}

/* Applies an element's own `x-bind:attr` directives against `data` (see `apply`, step 4) */
function bind(el: Elem, data: Record<string, unknown>, top: Record<string, unknown>): void {
  for (const { name, value } of [...el.attributes]) {
    if (!name.startsWith("x-bind:") || name === "x-bind:") continue;
    const result = evaluate(value, data, top);
    const attr = name.slice("x-bind:".length);
    if (result == null || (URL_ATTRIBUTES.has(attr.toLowerCase()) && unsafeUrl(String(result)))) el.removeAttribute(attr);
    else el.setAttribute(attr, String(result));
    el.removeAttribute(name);
  }
}
