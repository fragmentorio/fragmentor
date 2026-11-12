import type { Fields, Schema, SchemaFragment } from "../model/types/index.js";
import { validateFields } from "./validate/schema.js";

function builtin({ _type, label, fields }: { _type: string; label: string; fields: Record<string, Fields> }): SchemaFragment {
  const now = new Date().toISOString();
  return { _type, label, _path: `/${_type}.json`, _extension: "json", _hidden: false, _data: "", _size: 0, _raw: null, _updated_at: now, _created_at: now, fields: validateFields({ fields }) };
}

const TEXT = { _type: "text", text: "" };
const ITEM = { _type: "li", children: [TEXT] };

const inline = (label: string, _type: string) => builtin({ _type, label, fields: { children: { type: "fragments", allow: ["text", "a"], default: [TEXT] } } });

export const text = builtin({
  _type: "text",
  label: "Text",
  fields: {
    text: { type: "string" },
    bold: { type: "boolean", nullable: true },
    italic: { type: "boolean", nullable: true },
    underline: { type: "boolean", nullable: true },
    code: { type: "boolean", nullable: true },
  },
});

export const img = builtin({
  _type: "img",
  label: "Image",
  fields: {
    src: { type: "url" },
    alt: { type: "string" },
  },
});

export const a = builtin({
  _type: "a",
  label: "Link",
  fields: {
    href: { type: "url" },
    children: { type: "fragments", allow: ["text"], default: [TEXT] },
    target: { type: "string", nullable: true },
    rel: { type: "string", nullable: true },
  },
});

export const h1 = inline("Heading 1", "h1");
export const h2 = inline("Heading 2", "h2");
export const h3 = inline("Heading 3", "h3");
export const h4 = inline("Heading 4", "h4");
export const h5 = inline("Heading 5", "h5");
export const h6 = inline("Heading 6", "h6");
export const p = inline("Paragraph", "p");
export const li = inline("List Item", "li");

export const ul = builtin({
  _type: "ul",
  label: "Unordered List",
  fields: { children: { type: "fragments", allow: ["li"], default: [ITEM] } },
});

export const ol = builtin({
  _type: "ol",
  label: "Ordered List",
  fields: { children: { type: "fragments", allow: ["li"], default: [ITEM] } },
});

export const builtins: Schema[] = [text, img, a, h1, h2, h3, h4, h5, h6, p, li, ul, ol];
