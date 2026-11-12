import { parseNodes } from "./tag.js";

/**
 * Parses raw HTML into its object representation: every tag becomes
 * { _type, ...attributes, children }, tag name as _type, attributes spread
 * in as props, recursing into nested tags (custom components work the same
 * way, e.g. <Link url="#">Hi</Link> -> { _type: "Link", url: "#", children: { _type: "text", text: "Hi" } }).
 * Leaf text is always wrapped as a { _type: "text", text } fragment, never a bare string.
 * This is the same tag parser decodeMarkdown uses for embedded markup, just
 * run over the whole input instead of one block at a time.
 * Never throws: a broken/unterminated tag is dropped instead of corrupting
 * the rest of the document, and totally invalid input returns { children: [] }.
 */
export function decodeHtml(content: string): Record<string, unknown> {
  try {
    return { children: parseNodes(content, 0).nodes };
  } catch {
    return { children: [] };
  }
}
