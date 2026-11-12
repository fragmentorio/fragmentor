import { Component, ComponentSchema, Entry } from "../../model/types/index.js";
import { type } from "../../utils/path.js";
import { error, safeParse } from "../../utils/report.js";

/**
 * Turns a component Entry into a Component. `_data` is kept, the raw HTML is the component.
 * `_type` is derived from the file name's last segment ("/Product.Faq.html" -> "Faq").
 * @param errors Collects errors instead of throwing, the result is then null.
 */
export function sanitize({ entry, errors }: { entry: Entry; errors?: string[]; warnings?: string[] }): Component | null {
  const _type = type(entry._path);
  const { data, error: message } = safeParse(ComponentSchema, { ...entry, _type });
  return message === null ? data : error(`Invalid component: ${message}`, null, errors);
}
