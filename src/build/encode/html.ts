import { encodeAttrs, encodeTag } from "./tag.js";
import { blocks, marks, walker } from "./node.js";

/* A text fragment's marks as real tags (HTML has no markdown-style asterisks) */
const MARKS: Record<string, [string, string]> = {
  code: ["<code>", "</code>"],
  bold: ["<strong>", "</strong>"],
  italic: ["<em>", "</em>"],
  underline: ["<u>", "</u>"],
};

/**
 * Renders a single fragment/string/array node back into HTML, recursing
 * into its children. h1-h6/p/li/ul/ol/a and any unrecognized/custom _type
 * all render the same way: tag name as the element, props as attributes,
 * children rendered inside (encodeTag's generic path already covers this,
 * since HTML has no shorthand syntax to special-case the way markdown does).
 * Falls back to an empty string on anything it can't make sense of (see `walker`).
 */
const encodeNode = walker((type, { children, rest, node }, inner) => {
  if (type === "text") return marks(node, MARKS);
  if (type === "img") return `<img${encodeAttrs(rest)}>`;
  if (type === "code") return `<pre><code${rest.lang ? ` class="language-${rest.lang}"` : ""}>${rest.code ?? ""}</code></pre>`;
  return encodeTag(type, rest, inner(children));
});

/**
 * Serializes an object into raw HTML: "children" (the shape decodeHtml or
 * decodeMarkdown produces) is rendered back into tags, any other key is
 * ignored (HTML has no frontmatter equivalent).
 * Never throws: a broken node is dropped instead of failing the whole page.
 */
export function encodeHtml(value: Record<string, unknown>): string {
  return blocks(value.children, encodeNode).join("\n");
}
