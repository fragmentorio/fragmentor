import { isRecord } from "../../utils/object.js";

/** Parses a .json file's raw content into its object representation. Never throws: invalid JSON, or JSON that isn't an object (e.g. an array), returns {} instead of failing the whole load. */
export function decodeJson(content: string): Record<string, unknown> {
  try {
    const value = JSON.parse(content);
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}
