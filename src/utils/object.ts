/* Plain object and array helpers: guards, and flat dot-path views ("features.0.title") of nested data. No imports, so anything can use them */

/** Whether `value` is a plain object: not null, not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a path key addresses an array item: digits only ("0", "12"). */
export function isIndex(key: string | undefined): boolean {
  return key !== undefined && /^\d+$/.test(key);
}

/**
 * What a value is, for error messages: "null", "array" or its `typeof`.
 * @example kind([]) // "array"
 */
export function kind(value: unknown): string {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

/**
 * A value as a list: an array as is, null or undefined as [], anything else as a one-item list.
 * @example list("a") // ["a"]
 */
export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

/**
 * Flattens a nested object/array into a single-level object, keyed by the dot-separated path to each leaf value.
 * @param data The (possibly deeply nested) object or array to flatten.
 * @example flatten({ button: { text: "Click here" }, features: [{ title: "Feature 1" }] })
 * // { "button.text": "Click here", "features.0.title": "Feature 1" }
 */
export function flatten(data: unknown, prefix = "", result: Record<string, unknown> = {}): Record<string, unknown> {
  if (data !== null && typeof data === "object") {
    for (const [key, value] of Object.entries(data)) flatten(value, prefix ? `${prefix}.${key}` : key, result);
  } else {
    result[prefix] = data;
  }
  return result;
}
