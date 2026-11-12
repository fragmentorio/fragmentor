import { push } from "../sync/push/index.js";
import { plural } from "../utils/text.js";
import { target } from "./target.js";

export async function run(args: string[]): Promise<void> {
  const { sources, schemas, schema, document } = target(args, "push");

  console.log(`Pushing "${schema._type}"...`);
  const { pushed, failed } = await push({ schema, schemas, sources, document, fetch });

  for (const f of failed) console.error(`  error: ${f.path}: ${f.error}`);
  console.log(`Pushed ${plural(pushed.length, "document")}${failed.length ? `, ${failed.length} failed` : ""}`);
  if (failed.length) process.exit(1);
}
