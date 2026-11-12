import { stringify } from "yaml";

/** Serializes an object into YAML. Never throws: an unserializable value falls back to "{}\n". */
export function encodeYaml(value: unknown): string {
  try {
    return stringify(value, { lineWidth: 0 });
  } catch {
    return "{}\n";
  }
}
