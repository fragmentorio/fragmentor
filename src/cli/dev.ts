import { parseHTML } from "linkedom";
import { resolve, join } from "node:path";
import { createServer } from "node:http";
import { existsSync, watch } from "node:fs";
import { compile } from "../build/compile/index.js";
import { parse as parsePath } from "../utils/path.js";
import { MIME } from "../utils/mime.js";
import { plural } from "../utils/text.js";
import { FOLDERS, asset, flags, read, type Cache } from "./fs.js";
import { error, warn } from "./color.js";
import type { Source } from "../model/types/index.js";

/* Answers the number of the current build, which every served page polls to reload once it changes */
const BUILD = "/__fragmentor/build";

/* How long to wait for more file events before rebuilding, so one save (often a write, a rename and a change) rebuilds once */
const SETTLE = 30;

/*
 * Polls instead of holding an EventSource open: each open stream takes one of the browser's 6 connections per host, so a few tabs stalled navigation.
 * Hidden tabs don't poll, and catch up as soon as they're shown again.
 */
const reloader = (build: number) =>
  `<script>(()=>{const c=()=>{if(!document.hidden)fetch("${BUILD}",{cache:"no-store"}).then(r=>r.text()).then(b=>{if(b!=="${build}")location.reload()},()=>{})};setInterval(c,1000);document.addEventListener("visibilitychange",c)})()</script>`;

/** Adds the live reload script to a page, before `</body>` (or at the end, for a page without one). */
function inject(html: string, build: number): string {
  const at = html.lastIndexOf("</body>");
  return at === -1 ? html + reloader(build) : html.slice(0, at) + reloader(build) + html.slice(at);
}

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
  const cache: Cache = new Map();

  let output = new Map<string, Source>();
  let build = 0;
  let sources: Source[] = [];
  /* The problems last printed, so a rebuild only prints them again when they change */
  let reported = "";

  /** Recompiles when a file changed since the last build (an editor touching a file without changing it doesn't count), and bumps `build` so open pages reload. */
  function rebuild() {
    try {
      const next = read(root, cache);
      if (build && next.length === sources.length && next.every((s, i) => s === sources[i])) return;
      sources = next;
      const result = compile(sources, { parse, dev: true });
      output = new Map(result.output.map((s) => [s.path, s]));
      build++;
      const errors = result.errors.map((e) => `  error: ${e.path}: ${e.message}`);
      const warnings = result.warnings.map((w) => `  warning: ${w.path}: ${w.message}`);
      const problems = [...errors, ...warnings].join("\n");
      if (problems !== reported) {
        if (!problems) console.log("  all problems fixed");
        errors.forEach(error);
        warnings.forEach(warn);
      }
      reported = problems;
    } catch (e) {
      error(`  build error: ${(e as Error).message}`);
      reported = "";
    }
  }

  rebuild();
  console.log(`Built ${plural([...output.keys()].filter((p) => p.endsWith(".html")).length, "page")}`);

  /* Watch every project folder, rebuilding once the events of a save have settled */
  let timer: NodeJS.Timeout | undefined;
  for (const folder of FOLDERS) {
    const dir = join(root, folder);
    if (!existsSync(dir)) continue;
    watch(dir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(rebuild, SETTLE);
    });
  }

  const server = createServer((req, res) => {
    let path = new URL(req.url ?? "/", `http://localhost`).pathname;
    if (path === BUILD) {
      res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      res.end(String(build));
      return;
    }
    if (path.endsWith("/")) path += "index.html";

    /* A page's route has no trailing slash ("/about", its `_slug`), but is built at "/about/index.html" */
    const file = output.get(path) ?? output.get(`${path}/index.html`);
    if (file) {
      try {
        /* A binary asset's bytes are on disk, in /assets/ */
        const data = file.data ?? bytes(file.path);
        const extension = parsePath(file.path).extension;
        res.writeHead(200, { "Content-Type": MIME[extension] ?? "application/octet-stream", "Cache-Control": "no-store" });
        res.end(extension === "html" && typeof data === "string" ? inject(data, build) : data);
        return;
      } catch {
        /* Gone since the last build: a 404 */
      }
    }

    /* 404 page, which reloads too, so it turns into the page once that's created */
    const notFound = output.get("/404.html")?.data;
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(inject(typeof notFound === "string" ? notFound : "<h1>404 Not Found</h1>", build));
  });

  server.on("error", (e: NodeJS.ErrnoException) => {
    error(e.code === "EADDRINUSE" ? `Port ${port} is already in use, try another with --port <port>` : `Dev server error: ${e.message}`);
    process.exit(1);
  });

  server.listen(port, host, () => {
    console.log(`Dev server running at http://${host}:${port}`);
    console.log("Press Ctrl+C to stop.");
  });
}
