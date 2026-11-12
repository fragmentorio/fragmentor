import type { Parser, Rendered } from "./render.js";
import { hash } from "../../utils/hash.js";

export { hash };

/* Where extracted styles and scripts are served from */
export const STYLES = "/_styles";
export const SCRIPTS = "/_scripts";

/* Script types the browser runs as JavaScript: any other type (application/ld+json, importmap, ...) is a data block and stays in place */
const EXECUTABLE = new Set(["", "text/javascript", "application/javascript", "module"]);

/**
 * Pulls every non-empty `<style>` and inline `<script>` out of a template and turns each into a file named after its
 * content hash, so two instances of the same component collapse into one file. A `<script src>` is already external and stays,
 * and so does a data block like `<script type="application/ld+json">`, which only works inside the page.
 * @returns The template without those tags, and `assets` mapping each file's path ("/_styles/<hash>.css") to its content.
 */
export function extract(html: string, parse: Parser): Rendered {
  const document = parse(html);
  const assets: Record<string, string> = {};
  for (const el of document.querySelectorAll("style, script")) {
    const content = el.textContent ?? "";
    if (!content.trim() || el.getAttribute("src")) continue;
    if (el.tagName.toLowerCase() === "script" && !EXECUTABLE.has((el.getAttribute("type") ?? "").trim().toLowerCase())) continue;
    assets[el.tagName.toLowerCase() === "style" ? `${STYLES}/${hash(content)}.css` : `${SCRIPTS}/${hash(content)}.js`] = content;
    /* The line break after the tag goes too, or every extracted tag leaves a blank line behind */
    const next = el.nextSibling;
    if (next?.nodeType === 3 && !next.textContent?.trim() && next.textContent?.includes("\n")) next.remove();
    el.remove();
  }
  return { html: document.toString(), assets };
}

/**
 * The inverse of `extract`: puts a page's assets back into its HTML, styles before `</head>` and scripts before `</body>`
 * (or prepended/appended for a bare fragment).
 * @param options.inline Embeds each asset's content instead of linking its path, for HTML with no server behind it (e.g. an iframe srcdoc).
 */
export function inject({ html, assets }: Rendered, options: { inline?: boolean } = {}): string {
  const files = Object.entries(assets);
  const styles = files.filter(([path]) => path.endsWith(".css")).map(([path, css]) => (options.inline ? `<style>${css}</style>` : `<link rel="stylesheet" href="${path}">`)).join("");
  const scripts = files.filter(([path]) => path.endsWith(".js")).map(([path, js]) => (options.inline ? `<script type="module">${js}</script>` : `<script type="module" src="${path}"></script>`)).join("");

  const head = close(html, "head");
  const out = head === -1 ? styles + html : html.slice(0, head) + styles + html.slice(head);
  const body = close(out, "body");
  return body === -1 ? out + scripts : out.slice(0, body) + scripts + out.slice(body);
}

/**
 * Prepares a rendered page for the site: joins its styles, in render order, into one stylesheet (a single render-blocking
 * file, shared by pages with the same components), then links every asset into the HTML (see `inject`).
 * @returns The final HTML, and the files to write next to it: one "/_styles/<hash>.css", and each script as it was.
 * @example bundle({ html: "<h1></h1>", assets: { "/_styles/a.css": "h1 {}", "/_styles/b.css": "p {}" } }) // { html: '<link rel="stylesheet" href="/_styles/<hash>.css"><h1></h1>', assets: { "/_styles/<hash>.css": "h1 {}\np {}" } }
 */
export function bundle({ html, assets }: Rendered): Rendered {
  const files = Object.entries(assets);
  const css = files.filter(([path]) => path.endsWith(".css")).map(([, data]) => data).join("\n");
  const bundled = Object.fromEntries(files.filter(([path]) => !path.endsWith(".css")));
  if (css) bundled[`${STYLES}/${hash(css)}.css`] = css;
  return { html: inject({ html, assets: bundled }), assets: bundled };
}

/** The index of the real `</tag>` in `html`, skipping comments and `<script>`/`<style>` bodies, or -1 when there's none. */
export function close(html: string, tag: string): number {
  const skip = /<!--[\s\S]*?(?:-->|$)|<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi;
  const end = new RegExp(`</${tag}\\s*>`, "i");
  let cursor = 0;
  for (let match = skip.exec(html); match; match = skip.exec(html)) {
    const found = end.exec(html.slice(cursor, match.index));
    if (found) return cursor + found.index;
    cursor = match.index + match[0].length;
  }
  const found = end.exec(html.slice(cursor));
  return found ? cursor + found.index : -1;
}
