/* Build: turn a project's sources into a site */
export { compile, type Parser } from "./build/compile/index.js";
export { optimize } from "./build/optimize/index.js";
export { lint } from "./build/lint/index.js";

/* Content: move between raw files and structured entries */
export { source, read, write } from "./build/source/index.js";
export { decode } from "./build/decode/index.js";
export { encode } from "./build/encode/index.js";

/* Sync: exchange documents with external APIs */
export { pull } from "./sync/pull/index.js";
export { push } from "./sync/push/index.js";

/* Data model */
export type { Source, Schema, Document, Fragment, Entry } from "./model/types/index.js";
