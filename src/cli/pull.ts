import { join } from "node:path";
import { unlinkSync } from "node:fs";
import { pull } from "../sync/pull/index.js";
import { plural } from "../utils/text.js";
import { write } from "./fs.js";
import { target } from "./target.js";

export async function run(args: string[]): Promise<void> {
  const { root, sources, schemas, schema, document } = target(args, "pull");

  console.log(`Pulling "${schema._type}"...`);
  const { pulled, pruned, failed } = await pull({ schema, schemas, sources, document, fetch });

  for (const f of failed) console.error(`  error: ${f.path}: ${f.error}`);
  write(pulled, root);
  for (const s of pruned) {
    try {
      unlinkSync(join(root, s.path));
      console.log(`  pruned: ${s.path}`);
    } catch {
      /* Ignore if already gone */
    }
  }

  console.log(`Pulled ${plural(pulled.length, "document")}${pruned.length ? `, pruned ${pruned.length}` : ""}${failed.length ? `, ${failed.length} failed` : ""}`);
  if (failed.length) process.exit(1);
}
