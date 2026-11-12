import { VOID_TAGS } from "../decode/tag.js";
import { isReserved } from "../../model/types/index.js";

/* Renders a fragment's props (everything but _type/children) back into HTML/JSX attributes */
export function encodeAttrs(props: Record<string, unknown>): string {
  return Object.entries(props)
    .flatMap(([key, value]) => {
      if (value === true) return [` ${key}`];
      if (value === false || value === undefined || value === null) return [];
      return [` ${key}="${String(value).replace(/"/g, "&quot;")}"`];
    })
    .join("");
}

/*
 * Renders a fragment back into an HTML/JSX tag, `inner` being its already-
 * rendered children (self-closing when there's none). Shared by the markdown
 * and HTML encoders: markdown uses it for any custom-component fallback,
 * HTML uses it for every structural tag (h1-h6, p, li, ul/ol, a, and any
 * unrecognized/custom _type). Without children, a void tag or custom component
 * self-closes, while any other HTML tag gets an explicit closing tag, since
 * HTML ignores "/>" on those (`<p/>` would swallow every sibling after it).
 */
export function encodeTag(type: string, props: Record<string, unknown>, inner: string): string {
  const attrs = encodeAttrs(props);
  return inner || (isReserved(type) && !VOID_TAGS.has(type)) ? `<${type}${attrs}>${inner}</${type}>` : `<${type}${attrs}/>`;
}
