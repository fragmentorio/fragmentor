/** Serializes an object into pretty-printed JSON. Never throws: an unserializable value (e.g. a circular reference) falls back to "{}\n". */
export function encodeJson(value: unknown): string {
  try {
    return `${JSON.stringify(value, null, 2)}\n`;
  } catch {
    return "{}\n";
  }
}
