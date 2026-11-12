import { parseHTML } from "linkedom";
import { resolve, join } from "node:path";
import { createServer } from "node:http";
import { existsSync, watch } from "node:fs";
import { compile } from "../build/compile/index.js";
import { parse as parsePath } from "../utils/path.js";
import { MIME } from "../utils/mime.js";
import { plural } from "../utils/text.js";
import { FOLDERS, asset, flags, read } from "./fs.js";
import type { Source } from "../model/types/index.js";

export async function run(args: string[]): Promise<void> {
  const opts = flags(args);

  if (opts["help"]) {
    console.log("Usage: fragmentor dev [options]\n");
    console.log("Options:");
    console.log("  --root <dir>    Project root (default: .)");
    console.log("  --port <port>   Port to listen on (default: 3000)");
    console.log("  --host <host>   Interface to listen on (default: localhost, 0.0.0.0 to share on your network)");
    process.exit(0);
  }

  const root = resolve(opts["root"] ?? ".");
  const port = Number(opts["port"] ?? 3000);
  /* Local only by default, so drafts (hidden documents are served in dev) aren't visible to the whole network */
  const host = opts["host"] ?? "localhost";
  const parse = (html: string) => parseHTML(html).document;
  const bytes = asset(root);

  let output: Source[] = [];

  function rebuild() {
    try {
      const sources = read(root);
      const result = compile(sources, { parse, dev: true });
      output = result.output;
      for (const e of result.errors) console.error(`  error: ${e.path}: ${e.message}`);
      for (const w of result.warnings) console.warn(`  warning: ${w.path}: ${w.message}`);
      console.log(`  rebuilt (${plural(output.filter((s) => s.path.endsWith(".html")).length, "page")})`);
    } catch (e) {
      console.error(`  build error: ${(e as Error).message}`);
    }
  }

  rebuild();

  /* Watch for changes in all project folders */
  for (const folder of FOLDERS) {
    const dir = join(root, folder);
    if (!existsSync(dir)) continue;
    watch(dir, { recursive: true }, () => {
      process.stdout.write(`  change detected, `);
      rebuild();
    });
  }

  const server = createServer((req, res) => {
    let path = new URL(req.url ?? "/", `http://localhost`).pathname;
    if (path.endsWith("/")) path += "index.html";

    const file = output.find((s) => s.path === path);
    if (file) {
      try {
        /* A binary asset's bytes are on disk, in /assets/ */
        const data = file.data ?? bytes(path);
        res.writeHead(200, { "Content-Type": MIME[parsePath(path).extension] ?? "application/octet-stream" });
        res.end(data);
        return;
      } catch {
        /* Gone since the last build: a 404 */
      }
    }

    /* 404 page */
    const notFound = output.find((s) => s.path === "/404.html");
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(notFound?.data ?? "<h1>404 Not Found</h1>");
  });

  server.listen(port, host, () => {
    console.log(`\nDev server running at http://${host}:${port}`);
    console.log("Press Ctrl+C to stop.\n");
  });
}
