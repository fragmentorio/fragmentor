import { encodeYaml } from "./yaml.js";
import { encodeTag } from "./tag.js";
import { blocks, marks, walker } from "./node.js";
import { isRecord, list } from "../../utils/object.js";

const HEADING_TYPE = /^h([1-6])$/;

/* A text fragment's marks in markdown syntax (markdown has no underline syntax, so that flag is dropped) */
const MARKS: Record<string, [string, string]> = {
  code: ["`", "`"],
  bold: ["**", "**"],
  italic: ["*", "*"],
};

/**
 * Renders a single fragment/string/array node back into markdown, recursing
 * into its children. Falls back to an empty string on anything it can't
 * make sense of (see `walker`).
 */
const encodeNode = walker((type, { children, rest, node }, inner) => {
  if (type === "text") return marks(node, MARKS);
  if (type === "a") return `[${inner(children)}](${rest.href ?? ""})`;
  if (type === "img") return `![${rest.alt ?? ""}](${rest.src ?? ""})`;
  if (type === "code") return `\`\`\`${rest.lang ?? ""}\n${rest.code ?? ""}\n\`\`\``;
  const heading = type.match(HEADING_TYPE);
  if (heading) return `${"#".repeat(Number(heading[1]))} ${inner(children)}`;
  if (type === "p" || type === "li") return inner(children);
  /* A ul/ol's items, one per line, each item's own content after its bullet */
  if (type === "ul" || type === "ol") {
    return list(children).map((item, i) => `${type === "ol" ? `${i + 1}. ` : "- "}${inner(isRecord(item) && item._type === "li" ? item.children : item)}`).join("\n");
  }
  return encodeTag(type, rest, inner(children));
});

/**
 * Serializes an object into a .md file: any key other than "children" is
 * written as YAML frontmatter, and "children" (an array of RichTextFragment
 * or custom-tag blocks, the shape decodeMarkdown produces) becomes the body.
 * Never throws: a broken block is dropped instead of failing the whole file.
 */
export function encodeMarkdown(value: Record<string, unknown>): string {
  const { children, ...frontmatter } = value;
  const fm = Object.keys(frontmatter).length ? `---\n${encodeYaml(frontmatter)}---\n\n` : "";
  const body = blocks(children, encodeNode);
  return fm + body.join("\n\n") + (body.length ? "\n" : "");
}
