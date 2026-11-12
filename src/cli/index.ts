#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { red } from "./color.js";

const [, , command, ...args] = process.argv;

const commands: Record<string, string> = {
  build: "./build.js",
  dev: "./dev.js",
  pull: "./pull.js",
  push: "./push.js",
};

if (!command || command === "--help" || command === "-h") {
  const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../package.json"), "utf8")) as { version: string };
  console.log(`fragmentor ${pkg.version}\n`);
  console.log("Usage: fragmentor <command> [options]\n");
  console.log("Commands:");
  console.log("  build   Build the project");
  console.log("  dev     Start the dev server");
  console.log("  pull    Pull documents from an external API");
  console.log("  push    Push documents to an external API\n");
  console.log("Run `fragmentor <command> --help` for more information.");
  process.exit(0);
}

if (!(command in commands)) {
  console.error(red(`Unknown command: ${command}`));
  console.error("Run `fragmentor --help` for available commands.");
  process.exit(1);
}

/* Dynamic import so each command only loads what it needs */
const { run } = await import(commands[command]!);
await run(args);
