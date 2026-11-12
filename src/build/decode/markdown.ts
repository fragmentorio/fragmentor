import { decodeYaml } from "./yaml.js";
import { parseNodes } from "./tag.js";
import type { Fragment, TextFragment, LinkFragment, ImageFragment, HeadingFragment, ParagraphFragment, ItemFragment, ListFragment, RichTextFragment } from "../../model/types/index.js";

export type CodeFragment = Fragment<"code"> & { code: string; lang?: string };
export type Block = RichTextFragment | CodeFragment | Fragment;

/* A YAML frontmatter block: its opening "---" line, its YAML, and its closing "---" line. Shared with `write`, which edits it in place */
export const FRONTMATTER = /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)/;
const HEADING = /^(#{1,6})\s+(.+)$/;
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const LIST_ITEM = /^\s*(?:[-*]|\d+\.)\s+(.*)$/;
const ORDERED_ITEM = /^\s*\d+\.\s+/;
const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_(.+?)_|\[([^\]]*)\]\(([^)]+)\)/g;
const CODE_FENCE = /^```([^\n]*)\r?\n([\s\S]*?)\r?\n```$/;
const FENCE_LINE = /^```/;

/* Splits the body into blocks on blank lines, except blank lines inside a ``` fence, which stay part of that block */
function splitBlocks(body: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  for (const line of body.split("\n")) {
    if (FENCE_LINE.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === "") {
      if (current.length) blocks.push(current.join("\n"));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks;
}

/* Splits inline markdown (code/bold/italic/links) into text/link fragments, code spans kept verbatim */
function parseInline(text: string): (TextFragment | LinkFragment)[] {
  const out: (TextFragment | LinkFragment)[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index! > last) out.push({ _type: "text", text: text.slice(last, match.index) });
    const [, code, bold1, bold2, italic1, italic2, linkText, linkHref] = match;
    if (code) out.push({ _type: "text", text: code, code: true });
    else if (bold1 ?? bold2) out.push({ _type: "text", text: bold1 ?? bold2, bold: true });
    else if (italic1 ?? italic2) out.push({ _type: "text", text: italic1 ?? italic2, italic: true });
    else out.push({ _type: "a", href: linkHref, children: [{ _type: "text", text: linkText }] });
    last = match.index! + match[0].length;
  }
  if (last < text.length) out.push({ _type: "text", text: text.slice(last) });
  return out;
}

/* Parses a blank-line-separated markdown block into a single fragment */
function parseBlock(block: string): Block {
  const code = block.match(CODE_FENCE);
  if (code) return { _type: "code", lang: code[1] || undefined, code: code[2] } as CodeFragment;

  if (block.includes("<")) {
    try {
      const { nodes } = parseNodes(block, 0);
      if (nodes.length === 1 && nodes[0]._type !== "text") return nodes[0];
      if (nodes.some((node) => node._type !== "text")) {
        const children = nodes.flatMap((node) => (node._type === "text" ? parseInline((node as TextFragment).text) : [node]));
        return { _type: "p", children } as unknown as ParagraphFragment;
      }
    } catch {
      /* malformed markup: fall through to plain markdown parsing below */
    }
  }

  const heading = block.match(HEADING);
  if (heading) return { _type: `h${heading[1].length}`, children: parseInline(heading[2]) } as HeadingFragment;

  const image = block.match(IMAGE_LINE);
  if (image) return { _type: "img", alt: image[1], src: image[2] } as ImageFragment;

  const lines = block.split("\n");
  if (lines.every((line) => LIST_ITEM.test(line))) {
    const items: ItemFragment[] = lines.map((line) => ({ _type: "li", children: parseInline(line.match(LIST_ITEM)![1]) }));
    return { _type: ORDERED_ITEM.test(lines[0]) ? "ol" : "ul", children: items } as ListFragment;
  }

  return { _type: "p", children: parseInline(block.replace(/\s*\n\s*/g, " ")) } as ParagraphFragment;
}

/**
 * Parses a .md file's raw content into its object representation: YAML
 * frontmatter fields spread at the top level, with the body parsed into
 * a "children" array of RichTextFragment blocks (p, h1-h6, ul/ol, img, a, code),
 * left out when the body is empty.
 * HTML/JSX-like tags outside code fences (including custom components, e.g.
 * <Link url="#">Hi</Link>) are parsed recursively into { _type, ...props,
 * children }, tag name as _type and attributes spread in as props.
 * Never throws: a broken frontmatter field, body block, or tag is dropped
 * instead of corrupting the whole document, and totally invalid input
 * returns {}.
 */
export function decodeMarkdown(content: string): Record<string, unknown> {
  try {
    const match = content.match(FRONTMATTER);
    const frontmatter = match ? decodeYaml(match[2]) : {};
    const body = match ? content.slice(match[0].length) : content;

    const children = splitBlocks(body)
      .map((block) => block.trim())
      .filter(Boolean)
      .flatMap((block) => {
        try {
          return [parseBlock(block)];
        } catch {
          return [];
        }
      });

    return children.length ? { ...frontmatter, children } : frontmatter; /* a frontmatter-only file has no body, so no children */
  } catch {
    return {};
  }
}
