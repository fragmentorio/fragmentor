/* What `fragmentor pull` and `fragmentor push` share: their usage, and finding the schema and document they run on */
import { resolve, join } from "node:path";
import { schemas as readSchemas } from "../build/source/read.js";
import { getSchema } from "../model/schema.js";
import type { Schema, Source } from "../model/types/index.js";
import { flags, read } from "./fs.js";
import { error } from "./color.js";

/**
 * Parses a `pull` or `push` command's arguments ("<schema> [--root <dir>] [--document <path>]") and reads its project.
 * Prints the usage and exits on --help or without a schema, and exits with an error when the schema doesn't exist, has no `verb` spec, or --document isn't a file.
 */
export function target(args: string[], verb: "pull" | "push"): { root: string; sources: Source[]; schemas: Schema[]; schema: Schema; document?: Source } {
  const type = args[0]?.startsWith("-") ? undefined : args[0];
  const opts = flags(type ? args.slice(1) : args);
  const Verb = verb[0].toUpperCase() + verb.slice(1);

  if (opts["help"] || !type) {
    console.log(`Usage: fragmentor ${verb} <schema> [options]\n`);
    console.log("Arguments:");
    console.log(`  schema          Schema type to ${verb}\n`);
    console.log("Options:");
    console.log("  --root <dir>    Project root (default: .)");
    console.log(`  --document <p>  ${Verb} only the document at this path`);
    process.exit(opts["help"] ? 0 : 1);
  }

  const root = resolve(opts["root"] ?? ".");
  const sources = read(root);
  const schemas = readSchemas(sources);
  const schema = getSchema({ schemas, type });
  if (!schema) fail(`Schema "${type}" not found in ${join(root, "schemas")}`);
  if (!schema[verb]) fail(`Schema "${type}" has no ${verb} spec`);

  const document = opts["document"] ? sources.find((s) => s.path === opts["document"]) : undefined;
  if (opts["document"] && !document) fail(`Document not found: ${opts["document"]}`);

  return { root, sources, schemas, schema, document };
}

function fail(message: string): never {
  error(message);
  process.exit(1);
}
