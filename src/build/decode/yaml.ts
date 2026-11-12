import { parseDocument, isMap, isSeq, isScalar, isAlias, type Document } from "yaml";
import { isRecord } from "../../utils/object.js";

const MAX_ALIAS_DEPTH = 50;

/* Recursively converts a yaml AST node to a plain JS value, dropping any key/item that fails instead of corrupting the rest of the structure. `doc` is needed to resolve *alias references back to their &anchor. */
function toSafeValue(node: unknown, doc: Document, depth = 0): unknown {
  if (depth > MAX_ALIAS_DEPTH) throw new Error("Alias nesting too deep");

  if (isAlias(node)) return toSafeValue(node.resolve(doc), doc, depth + 1);

  if (isMap(node)) {
    const out: Record<string, unknown> = {};
    for (const pair of node.items) {
      try {
        out[String(toSafeValue(pair.key, doc, depth))] = toSafeValue(pair.value, doc, depth);
      } catch {
        /* drop this key, keep the rest of the object intact */
      }
    }
    return out;
  }
  if (isSeq(node)) {
    return node.items.flatMap((item) => {
      try {
        return [toSafeValue(item, doc, depth)];
      } catch {
        return [];
      }
    });
  }
  if (isScalar(node)) return node.value;
  return node;
}

/** Parses a .yaml/.yml file's raw content into its object representation. Never throws: a broken key/value is dropped instead of corrupting the whole object, and totally invalid input, or YAML that isn't a map (e.g. a list), returns {}. */
export function decodeYaml(content: string): Record<string, unknown> {
  try {
    const doc = parseDocument(content);
    const value = toSafeValue(doc.contents, doc);
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}
