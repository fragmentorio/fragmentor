import type { Schema } from "../../model/types/index.js";
import { locate } from "../../model/fragment.js";
import { getSchema } from "../../model/schema.js";

/* An opening tag with its attributes, quoted values may contain ">" */
const TAG_OPEN = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g;

/**
 * Tags every element in a raw template with `x-src="file:line:n"`, pointing back to where it was authored, so the editor
 * can map a rendered element to its template. Runs on raw text before parsing, since no DOM parser keeps line numbers.
 * `<script>`/`<style>` bodies are copied verbatim: tag-like text inside JS/CSS isn't markup.
 * @param html Raw template HTML.
 * @param file Name recorded in each x-src, e.g. the component's _type.
 * @example annotate("<div>\n<p>Hi</p></div>", "faq") // '<div x-src="faq:1:0">\n<p x-src="faq:2:1">Hi</p></div>'
 */
export function annotate(html: string, file: string): string {
  let n = 0;
  let line = 1;
  let cursor = 0;
  let out = "";
  const lines = (from: number, to: number) => html.slice(from, to).split("\n").length - 1;

  TAG_OPEN.lastIndex = 0;
  for (let match = TAG_OPEN.exec(html); match; match = TAG_OPEN.exec(html)) {
    const [full, tag, raw] = match;
    line += lines(cursor, match.index);
    out += html.slice(cursor, match.index);

    if (/^(script|style)$/i.test(tag)) {
      const close = new RegExp(`</${tag}\\s*>`, "i").exec(html.slice(match.index));
      const end = close ? match.index + close.index + close[0].length : html.length;
      out += html.slice(match.index, end);
      line += lines(match.index, end);
      cursor = TAG_OPEN.lastIndex = end;
      continue;
    }

    const self = raw.trimEnd().endsWith("/");
    const attrs = (self ? raw.trimEnd().slice(0, -1) : raw).trimEnd();
    out += `<${tag}${attrs} x-src="${file}:${line}:${n++}"${self ? " /" : ""}>`;
    cursor = match.index + full.length;
  }
  return out + html.slice(cursor);
}

/**
 * Every object reachable from `document`, mapped to its field path (getFragment/setFragment shape), so a rendered fragment's
 * path is where it lives, however the template reached it ("hero", "$.site.footer", "items.slice(0, 3)"). The shortest path
 * wins when an object is reachable several ways (a document referenced twice, or a loop back through a reference).
 * @example paths({ _type: "page", sections: [hero] }).get(hero) // ["sections", "0"]
 */
export function paths(document: Record<string, unknown>): Map<object, string[]> {
  const found = new Map<object, string[]>([[document, []]]);
  const queue: [object, string[]][] = [[document, []]];
  for (const [value, path] of queue) {
    for (const [key, child] of Object.entries(value)) {
      if (!child || typeof child !== "object" || found.has(child)) continue;
      found.set(child, [...path, key]);
      queue.push([child, [...path, key]]);
    }
  }
  return found;
}

/**
 * The editor's pointers for the fragment at `path` in `document`: always its `x-path`, the field path (getFragment/setFragment
 * shape) so the editor can map a rendered element back to the field that produced it, plus its `x-type` and `x-allow` (the
 * types its field accepts, space separated) when `schemas` describe the field it sits in with an `allow` list (a fragment,
 * fragments, reference or references field). The root needs no pointers.
 * An array item's path ends with its index ("sections.1"), a single field's with the field ("hero.media").
 * @example pointers(page, ["sections", "1"], schemas) // { "x-path": "sections.1", "x-type": "hero", "x-allow": "hero cta" }
 */
export function pointers(document: Record<string, unknown>, path: string[], schemas?: Schema[]): Record<string, string> {
  if (!path.length) return {};
  const at = (p: string[]) => p.reduce<any>((value, key) => value?.[key], document);
  const { parent, key } = locate(path);
  const field = getSchema({ schemas, type: at(parent)?._type })?.fields[key];
  if (!field || !("allow" in field)) return { "x-path": path.join(".") };
  return { "x-path": path.join("."), "x-type": at(path)._type, "x-allow": (field.allow as string[]).join(" ") };
}
