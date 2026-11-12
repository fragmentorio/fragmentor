import { declared } from "../decode/index.js";
import { builtins } from "../builtins.js";
import { read, source } from "../source/index.js";
import { folder, parse as parsePath, path, slug } from "../../utils/path.js";
import { lint } from "../lint/index.js";
import { complete, resolve } from "../resolve/index.js";
import type { Source } from "../../model/types/index.js";
import { bundle } from "./assets.js";
import { robots, sitemap, stamp } from "./generate.js";
import { render, type Parser } from "./render.js";

/** Whether a source is a document file without `_type`: plain data that references can still point at, so it's no error to build with (even though `write.document` refuses to write one). */
function plain(source: Source): boolean {
  return folder(source.path) === "documents" && declared(source) === undefined;
}

export type Compiled = {
  output: Source[];
  errors: { path: string; message: string }[];
  warnings: { path: string; message: string }[];
};

/**
 * Compiles a project's sources into the files of its site, with no filesystem access so it runs anywhere:
 * 1. Reads schemas, documents, components and assets (`read.*`). Every problem `lint` finds in a file is listed in `errors` or `warnings` (except for a document
 *    without `_type`, which is plain data), but the file is still read leniently (invalid values replaced by defaults) so one bad field doesn't drop a page.
 * 2. Links each document's references (`complete`, then `resolve`). Its `_slug` is its route ("/blog/index.yml" -> "/blog").
 * 3. Renders a page for every visible document (every document in dev) whose _type has a component (see `render`), at "<slug>/index.html". With a `route`, only that one.
 * 4. Bundles each page (see `bundle`): its styles joined into one "/_styles/<hash>.css", its scripts each at "/_scripts/<hash>.js", all linked from the page.
 * 5. Stamps each page (see `stamp`): a "Made with Fragmentor" comment at the top, with `published` when it was published.
 * 6. With a `url`, generates "/sitemap.xml" and "/robots.txt" (see `sitemap` and `robots`).
 * 7. Passes assets through with "/assets" stripped ("/assets/images/logo" -> "/images/logo"). An asset wins over a page or generated file at the same path. One with an extension assets can't have is left out (and listed in `errors`).
 * @param sources Every source of the project, with its full path ("/documents/blog/hello", "/components/page", ...).
 * @param options.parse Parses HTML: linkedom on the server, the native DOM in the browser.
 * @param options.dev Adds the editor's `x-src`/`x-path` pointers to every page, and keeps hidden documents (a leading ".") so drafts can be previewed.
 * @param options.url The site's base URL ("https://example.com"), needed for the absolute URLs in the generated files.
 * @param options.route Renders only the page at this route ("/blog"), for a preview that shows one page at a time and recompiles on every edit.
 * @param options.published When the site goes live, stamped on every page. Passed by the caller so the build stays deterministic.
 * @returns The output files as Sources (write each to its `path`), and every error and warning by file.
 * @example compile(sources, { parse: (html) => parseHTML(html).document })
 */
export function compile(sources: Source[], { parse, dev = false, url, route, published }: { parse: Parser; dev?: boolean; url?: string; route?: string; published?: Date }): Compiled {
  /* A file whose name starts with "." is ignored, except a document in dev (so drafts can be previewed) and an asset (published as is) */
  sources = sources.filter((s) => !parsePath(s.path).hidden || folder(s.path) === "assets" || (dev && folder(s.path) === "documents"));
  const schemas = read.schemas(sources);
  /* _slug is a document's route ("/blog/index.yml" -> "/blog", see `sanitize.document`), so templates can link with x-bind:href="_slug", on a page and on a resolved reference */
  const documents = read.documents(sources, schemas);
  const components = read.components(sources);
  /* An asset's `_path` already has "/assets" stripped, so it's its output path. A binary asset has a null `_data` (its bytes live in storage at "/assets" + that path), so publishing copies those bytes */
  const assets = read.assets(sources).map((a): Source => ({ path: a._path, data: a._data, size: a._size, raw: a._raw, updated_at: a._updated_at, created_at: a._created_at }));
  const linted = lint({ sources, paths: sources.filter((s) => !plain(s)).map((s) => s.path) });
  const errors: Compiled["errors"] = linted.flatMap(({ path, errors }) => errors.map((message) => ({ path, message })));
  const warnings: Compiled["warnings"] = linted.flatMap(({ path, warnings }) => warnings.map((message) => ({ path, message })));

  const types = [...builtins, ...schemas];
  /* Completed up front so null references fill in on referenced documents too (e.g. a Site's navigation), not only on the page */
  const completed = documents.map((d) => complete({ document: d, schemas: types, references: documents }) as typeof d);
  const pages = completed.filter((d) => (!route || d._slug === slug(route)) && components.some((c) => c._type === d._type));

  const output = new Map<string, Source>();
  const emit = (file: Source) => output.set(file.path, file);
  for (const document of pages) {
    try {
      const page = resolve({ document, references: completed });
      const { html, assets } = bundle(render(page, components, parse, { dev, schemas }));
      emit(source({ path: `${path(document._slug)}.html`, data: stamp(html, { published }) }));
      for (const [at, data] of Object.entries(assets)) emit(source({ path: at, data }));
    } catch (e) {
      errors.push({ path: `/documents${document._path}`, message: (e as Error).message });
    }
  }

  /* Emitted before the assets so a provided /assets/sitemap.xml or /assets/robots.txt wins, but listing asset pages too */
  if (url) {
    emit(sitemap(url, [...output.values(), ...assets]));
    emit(robots(url));
  }

  for (const asset of assets) emit(asset);

  return { output: [...output.values()], errors, warnings };
}

export { render, lookup, type Parser, type Parsed, type Rendered } from "./render.js";
export { bundle, extract, inject } from "./assets.js";
export { annotate } from "./annotate.js";
