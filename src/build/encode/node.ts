import { list } from "../../utils/object.js";

/* What the HTML and markdown encoders share: walking a fragment tree, wrapping a text run in its marks, and encoding the top-level blocks */

/* Encodes one fragment, given its `_type`, its `children`, its other props and `inner` to encode any nested value the same way */
export type Encoder = (type: string, fragment: { children: unknown; rest: Record<string, unknown>; node: Record<string, unknown> }, inner: (value: unknown) => string) => string;

/**
 * Builds a node encoder from a format's fragment encoder: null is "", a string is itself, an array is its items joined, any other
 * primitive is its string, and a fragment (an object with a string `_type`) goes to `encoder`. Anything else is "".
 * Never throws: a fragment that fails encodes as "", so one broken fragment doesn't take down the rest of the file.
 */
export function walker(encoder: Encoder): (value: unknown) => string {
  const encode = (value: unknown): string => {
    try {
      if (value == null) return "";
      if (typeof value === "string") return value;
      if (Array.isArray(value)) return value.map(encode).join("");
      if (typeof value !== "object") return String(value);
      const { _type, children, ...rest } = value as Record<string, unknown>;
      if (typeof _type !== "string") return "";
      return encoder(_type, { children, rest, node: value as Record<string, unknown> }, encode);
    } catch {
      return "";
    }
  };
  return encode;
}

/**
 * Wraps a text fragment's text in each of its marks that's set, innermost first, in the order of `marks`. A format leaves out a mark it has no syntax for.
 * @example marks({ text: "Hi", bold: true }, { bold: ["<strong>", "</strong>"] }) // "<strong>Hi</strong>"
 */
export function marks(node: Record<string, unknown>, marks: Record<string, [string, string]>): string {
  let text = String(node.text ?? "");
  for (const [mark, [open, close]] of Object.entries(marks)) if (node[mark]) text = `${open}${text}${close}`;
  return text;
}

/** Every top-level block of `children` encoded with `encode`, leaving out those that encode to "". */
export function blocks(children: unknown, encode: (value: unknown) => string): string[] {
  return list(children).map(encode).filter(Boolean);
}
