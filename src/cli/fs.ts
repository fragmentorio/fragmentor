/* Shared filesystem helpers for the CLI commands */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import type { Source } from "../model/types/index.js";
import { source } from "../build/source/index.js";
import { FOLDERS as PROJECT } from "../build/source/folders.js";
import { extension } from "../utils/mime.js";

/* The folders that make up a Fragmentor project */
export const FOLDERS = Object.keys(PROJECT);

/**
 * Reads all files in a project `root` into Source objects with the right paths. A file that isn't UTF-8 text (an image, a font, ...)
 * gets `data: null`, its bytes staying on disk (see `asset`), since decoding it as text would corrupt it.
 */
export function read(root: string): Source[] {
  const out: Source[] = [];
  for (const folder of FOLDERS) {
    const dir = join(root, folder);
    if (!existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const rel = relative(dir, file).replace(/\\/g, "/");
      const bytes = readFileSync(file);
      const data = extension(bytes) === "txt" ? bytes.toString("utf8") : null;
      out.push(source({ path: `/${folder}/${rel}`, data, size: bytes.length }));
    }
  }
  return out;
}

/** Reads the bytes of a project's asset by its output path ("/images/logo.png" is "<root>/assets/images/logo.png"), for a binary file with null `data`. */
export function asset(root: string): (path: string) => Buffer {
  return (path) => readFileSync(join(root, "assets", path));
}

/**
 * Writes files to `outDir`, creating directories as needed. A binary file with null `data` is read with `bytes` (see `asset`), and skipped without it.
 * @example write(output, "dist", asset(root))
 */
export function write(files: Iterable<{ path: string; data: string | Uint8Array | null }>, outDir: string, bytes?: (path: string) => Uint8Array): void {
  for (const file of files) {
    const data = file.data ?? bytes?.(file.path);
    if (data == null) continue;
    const dest = join(outDir, file.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, data);
  }
}

/** Recursively lists all files under `dir`. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Parses CLI flags into a simple key/value map. Boolean flags (no value) get the value "true". */
export function flags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) { out[key] = next; i++; }
      else out[key] = "true";
    }
  }
  return out;
}
