/* Pipeline: turn a project's sources into a site, and sync documents with external APIs */
export { compile, type Parser } from "./build/compile/index.js";
export { optimize } from "./build/optimize/index.js";
export { lint } from "./build/lint/index.js";
export { pull } from "./sync/pull/index.js";
export { push } from "./sync/push/index.js";
export { builtins } from "./build/builtins.js";

/* Sources: move between raw files and structured entries */
export { source } from "./build/source/index.js";
export { decode } from "./build/decode/index.js";
export { encode } from "./build/encode/index.js";
export { patch, type Patch } from "./build/source/patch.js";

/* Namespaces: everything you can do with one kind of thing */
export * as path from "./api/path.js";
export * as document from "./api/document.js";
export * as schema from "./api/schema.js";
export * as component from "./api/component.js";
export * as asset from "./api/asset.js";

/* Data model */
export type { Source, Schema, Document, Fragment, Entry } from "./model/types/index.js";
