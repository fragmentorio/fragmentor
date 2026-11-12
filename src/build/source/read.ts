import { decode, entry } from "../decode/index.js";
import * as sanitize from "../sanitize/index.js";
import * as validate from "../validate/index.js";
import { error, warning } from "../../utils/report.js";
import { folder, inside, parse } from "../../utils/path.js";
import { FOLDERS, type Folder } from "./folders.js";
import { builtins } from "../builtins.js";
import type { Asset, Component, Document, Schema, Source } from "../../model/types/index.js";

/**
 * Checks that a Source is in the `root` folder with one of that folder's extensions (see `FOLDERS`), then strips that folder from its path ("/documents/blog/hello.yml" -> "/blog/hello.yml").
 * @throws When the Source isn't in `root`, or its extension isn't allowed there.
 */
function within(source: Source, root: Folder): Source {
  const { extension } = parse(source.path);
  const extensions: string[] = FOLDERS[root];
  if (!extensions.includes(extension)) throw new Error(`/${root}/ only takes ${extensions.map((e) => e ? `.${e}` : "extensionless").join(", ")} files, got "${source.path}"`);
  return { ...source, path: inside(source.path, root) };
}

/* What `reader` reads from every Source in the `root` folder, leniently: a file that doesn't read is left out */
function every<T>(sources: Source[], root: Folder, reader: (source: Source) => T | null): T[] {
  return sources.flatMap((source) => folder(source.path) === root ? reader(source) ?? [] : []);
}

/** Every schema among a project's `sources` (the files in /schemas/ that read), leniently: a broken schema is left out. */
export function schemas(sources: Source[]): Schema[] {
  return every(sources, "schemas", (source) => schema({ source, errors: [] }));
}

/** Every document among a project's `sources` (the files in /documents/ that read), leniently: invalid values get their field's default, and a file without a document's shape is left out (see `document`). */
export function documents(sources: Source[], schemas: Schema[]): Document[] {
  return every(sources, "documents", (source) => document({ source, schemas, errors: [] }));
}

/** Every component among a project's `sources` (the files in /components/ that read), leniently: an invalid component is left out. */
export function components(sources: Source[]): Component[] {
  return every(sources, "components", (source) => component({ source, errors: [] }));
}

/** Every asset among a project's `sources` (the files in /assets/ that read), leniently: an asset with an extension assets can't have is left out. */
export function assets(sources: Source[]): Asset[] {
  return every(sources, "assets", (source) => asset({ source, errors: [] }));
}

/**
 * Reads a schema Source (decode -> sanitize -> validate). `_type` is the file name, e.g. "schemas/page.json" -> "page".
 * @param schemas The project's schemas, to warn about types it names that don't exist. Built-in schemas (p, h1, text, ...) are always included.
 * @param errors Collects errors instead of throwing: invalid field definitions are fixed with defaults and a file without a schema's shape returns null (reads). Leave it out to throw (writes).
 * @param warnings Collects warnings.
 */
export function schema({ source, schemas, errors, warnings }: { source: Source; schemas?: Schema[]; errors?: string[]; warnings?: string[] }): Schema | null {
  try {
    source = within(source, "schemas");
    const schema = sanitize.schema({ entry: decode({ source, errors, warnings }), errors, warnings });
    return schema && validate.schema({ schema, schemas: schemas && [...builtins, ...schemas], errors, warnings });
  } catch (e) {
    return error((e as Error).message, null, errors);
  }
}

/**
 * Reads a document Source (decode -> sanitize -> validate against its schema). Built-in schemas (p, h1, text, ...) are always included.
 * @param schemas The project's schemas.
 * @param errors Collects errors instead of throwing: invalid values are replaced with their field's default (reads). Leave it out to throw (writes).
 * @param warnings Collects warnings.
 * @returns null (or throws, without `errors`) for a file without `_type` or `_id` (see `sanitize.document`), or without a document's shape.
 */
export function document({ source, schemas = [], errors, warnings }: { source: Source; schemas?: Schema[]; errors?: string[]; warnings?: string[] }): Document | null {
  try {
    source = within(source, "documents");
    const document = sanitize.document({ entry: decode({ source, errors, warnings }), errors, warnings });
    if (!document) return null;
    if (schemas.some((s) => s._type === document._type && !s.document)) warning(`"${document._type}" isn't a document schema (document: true), so it shouldn't live in /documents/`, null, warnings);
    return validate.document({ document, schemas: [...builtins, ...schemas], errors, warnings });
  } catch (e) {
    return error((e as Error).message, null, errors);
  }
}

/**
 * Reads a component Source. Nothing is decoded: the raw HTML, kept in `_data`, is the template.
 * `_type` is the type it renders, the file name's last segment ("components/Product.Faq.html" -> "Faq"), see `sanitize.component`.
 * @param errors Collects errors instead of throwing: a file outside /components/, a non-.html file or an invalid component returns null (reads). Leave it out to throw (writes).
 * @param warnings Collects warnings.
 */
export function component({ source, errors, warnings }: { source: Source; errors?: string[]; warnings?: string[] }): Component | null {
  try {
    return sanitize.component({ entry: entry(within(source, "components")), errors, warnings });
  } catch (e) {
    return error((e as Error).message, null, errors);
  }
}

/**
 * Reads an asset Source. Nothing is decoded: an asset's content is passed through as-is in `_data` (null for binary files).
 * @param errors Collects errors instead of throwing: a file outside /assets/, or with an extension assets can't have, returns null (reads). Leave it out to throw (writes).
 * @param warnings Collects warnings.
 */
export function asset({ source, errors, warnings }: { source: Source; errors?: string[]; warnings?: string[] }): Asset | null {
  try {
    return sanitize.asset({ entry: entry(within(source, "assets")), errors, warnings });
  } catch (e) {
    return error((e as Error).message, null, errors);
  }
}
