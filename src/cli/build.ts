import { parseHTML } from "linkedom";
import { resolve, join } from "node:path";
import { compile } from "../build/compile/index.js";
import { optimize } from "../build/optimize/index.js";
import { plural } from "../utils/text.js";
import { asset, flags, read, write } from "./fs.js";

export async function run(args: string[]): Promise<void> {
  const opts = flags(args);

  if (opts["help"]) {
    console.log("Usage: fragmentor build [options]\n");
    console.log("Options:");
    console.log("  --root <dir>    Project root (default: .)");
    console.log("  --out <dir>     Output directory (default: dist)");
    console.log("  --url <url>     Site base URL for sitemap and robots.txt");
    console.log("  --no-optimize   Skip image and CSS/JS optimization");
    process.exit(0);
  }

  const root = resolve(opts["root"] ?? ".");
  const outDir = resolve(opts["out"] ?? join(root, "dist"));
  const url = opts["url"];
  const noOptimize = opts["no-optimize"] === "true";

  console.log(`Building ${root}...`);
  const sources = read(root);
  const parse = (html: string) => parseHTML(html).document;
  const published = new Date();

  const { output, errors, warnings } = compile(sources, { parse, url, published });

  for (const w of warnings) console.warn(`  warning: ${w.path}: ${w.message}`);
  for (const e of errors) console.error(`  error: ${e.path}: ${e.message}`);

  /* Binary assets have null data, their bytes are copied from /assets/ */
  const bytes = asset(root);
  if (!noOptimize) {
    const files = Object.fromEntries(output.map((s) => [s.path, s.data]));
    const { files: optimized, warnings: optWarnings } = await optimize(files, { parse, read: async (path) => bytes(path) });
    for (const w of optWarnings) console.warn(`  warning: ${w}`);
    write(Object.entries(optimized).map(([path, data]) => ({ path, data })), outDir, bytes);
  } else {
    write(output, outDir, bytes);
  }

  console.log(`Built ${plural(output.filter((s) => s.path.endsWith(".html")).length, "page")} to ${outDir}`);
  if (errors.length) process.exit(1);
}
