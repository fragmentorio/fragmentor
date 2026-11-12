import type { Fragment, TextFragment } from "../../model/types/index.js";

export type TagNode = TextFragment | Fragment;

/* Sticky (matched at `lastIndex`), so a tag is read in place instead of on a copy of the rest of the input */
const TAG_OPEN = /<([A-Za-z][\w.-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const MAX_TAG_DEPTH = 50;

/* HTML5 void elements: never have a closing tag, even without a self-closing "/>". Matched by exact case, since real HTML tags are always written lowercase and a custom component may otherwise collide (e.g. <Link>, unlike the void <link>). */
export const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

/* Reads a tag's attribute string into a props object, bare attributes (no "=") becoming true */
function parseAttrs(attrString: string): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [, key, dq, sq, bare] of attrString.matchAll(ATTR)) {
    if (key) props[key] = dq ?? sq ?? bare ?? true;
  }
  return props;
}

/*
 * Recursively reads HTML/JSX-like tags out of `html` starting at `pos`, up to
 * a matching `</stopAt>` (or the end of the string when stopAt is omitted).
 * A tag whose closing tag is never found throws, which the caller catches to
 * treat that "<" as literal text instead of swallowing the rest of the input.
 * Shared by the markdown and HTML decoders, since both need the same tag ->
 * { _type, ...props, children } shape. `failed` holds the positions of tags
 * already known not to close, shared by the whole parse (by position alone, so
 * one that only failed past MAX_TAG_DEPTH stays text when reached shallower).
 */
export function parseNodes(html: string, pos: number, stopAt?: string, depth = 0, failed = new Set<number>()): { nodes: TagNode[]; end: number } {
  if (depth > MAX_TAG_DEPTH) throw new Error("Markup nested too deeply");

  const nodes: TagNode[] = [];
  let text = "";
  /* Mid-stream: keep text exactly as written, it may carry meaningful spacing up to the next tag. Edge (`atEnd`): right-trim, since that's just source indentation before a closing tag or end of input. */
  const flush = (atEnd = false) => {
    const value = atEnd ? text.replace(/\s+$/, "") : text;
    if (value.trim() !== "") nodes.push({ _type: "text", text: value });
    text = "";
  };

  const close = stopAt ? new RegExp(`</${stopAt}\\s*>`, "y") : null;
  while (pos < html.length) {
    if (close) {
      close.lastIndex = pos;
      const match = close.exec(html);
      if (match) { flush(true); return { nodes, end: pos + match[0].length }; }
    }

    TAG_OPEN.lastIndex = pos;
    const open = html[pos] === "<" ? TAG_OPEN.exec(html) : null;
    if (open) {
      const [full, name, attrString, selfClose] = open;
      try {
        flush();
        const props = parseAttrs(attrString);
        if (selfClose || VOID_TAGS.has(name)) {
          nodes.push({ _type: name, ...props });
          pos += full.length;
        } else {
          /* Fails fast when it can't close: no closing tag after it, or it already failed here (retried once per way of reaching it, 20 stray tags took seconds) */
          if (failed.has(pos) || !html.includes(`</${name}`, pos)) throw new Error(`Unterminated <${name}>`);
          const { nodes: children, end } = parseNodes(html, pos + full.length, name, depth + 1, failed);
          nodes.push({ _type: name, ...props, ...(children.length === 0 ? {} : { children }) });
          pos = end;
        }
        continue;
      } catch {
        /* unterminated/malformed tag: fall through and treat "<" as literal text */
        failed.add(pos);
      }
    }

    /* Plain text up to the next "<", where a tag may start */
    const next = html.indexOf("<", pos + 1);
    const stop = next === -1 ? html.length : next;
    text += html.slice(pos, stop);
    pos = stop;
  }

  if (stopAt) throw new Error(`Unterminated <${stopAt}>`);
  flush(true);
  return { nodes, end: pos };
}
