import { read } from "../source/index.js";
import { folder, path } from "../../utils/path.js";
import { refs } from "../../model/fragment.js";
import { keyOf, getSchema } from "../../model/schema.js";
import type { Document, Schema, Source } from "../../model/types/index.js";

export type Lint = { path: string; errors: string[]; warnings: string[] };

/**
 * Reads each Source the way its folder expects (`read.*`) and collects the errors and warnings found, instead of throwing on the first one.
 * Documents are checked against the schemas among `sources`, so linting needs nothing else. Files outside the known folders come back clean.
 * A document that claims something another document also claims (see `claims`) gets a warning, e.g. a key or an _id held twice (an error for a route), and so does each reference to an _id no document has, and each asset that replaces a document's page (it wins at the same output path).
 * @param sources Every Source of the project, with their full `path` ("/documents/blog/hello.yml", ...), for its schemas and to find claims held twice.
 * @param paths Only lint the sources at these paths, the rest is still read. Defaults to every source.
 * @returns One entry per linted Source, in the order of `sources`.
 * @example lint({ sources, paths: ["/documents/hello.yml"] }) // hello: "_type: post\n" // [{ path: "/documents/hello.yml", errors: ["_id: missing in /hello.yml"], warnings: [] }]
 */
export function lint({ sources, paths }: { sources: Source[]; paths?: string[] }): Lint[] {
  const schemas = read.schemas(sources);
  const documents = read.documents(sources, schemas);
  /* Who holds each claim, every document's _id, and the document whose page is at each output path, by the document's full path */
  const holders = new Map<string, string[]>();
  for (const d of documents) for (const c of claims(d, schemas)) holders.set(c.id, [...(holders.get(c.id) ?? []), `/documents${d._path}`]);
  const ids = new Set(documents.map((d) => d._id));
  const pages = new Map(documents.map((d) => [`${path(d._slug)}.html`, `/documents${d._path}`]));

  return sources.filter((s) => !paths || paths.includes(s.path)).map((source) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const at = folder(source.path);
    if (at === "schemas") read.schema({ source, schemas, errors, warnings });
    if (at === "components") read.component({ source, errors, warnings });
    if (at === "documents") {
      const document = read.document({ source, schemas, errors, warnings });
      for (const c of document ? claims(document, schemas) : []) {
        const others = (holders.get(c.id) ?? []).filter((p) => p !== source.path);
        if (others.length) (c.error ? errors : warnings).push(`${c.label} is also used by ${others.join(", ")}`);
      }
      /* Only references in the schema's fields count, since the read drops any other key */
      for (const ref of new Set(refs(document))) if (!ids.has(ref)) warnings.push(`Reference "${ref}" doesn't exist`);
    }
    if (at === "assets") {
      /* An asset wins at the same output path: "/assets/about/index.html" replaces the page of "/documents/about.yml" */
      const page = pages.get(read.asset({ source, errors, warnings })?._path ?? "");
      if (page) warnings.push(`Replaces the page of ${page}`);
    }
    return { path: source.path, errors, warnings };
  });
}

/* Something only one document may hold, with `id` namespaced by its kind. `error` makes holding it twice an error instead of a warning */
type Claim = { id: string; label: string; error?: boolean };

/**
 * Everything a document holds that no other may: its route ("/about.yml", "/about.md" and "/about/index.yml" all serve "/about", an error),
 * its _id (references resolve by it), its key (see a schema's `key`, unique per type) and its type when that's a singleton. In the order they're reported.
 */
function claims(document: Document, schemas: Schema[]): Claim[] {
  const schema = getSchema({ schemas, type: document._type });
  const key = schema && keyOf(document, schema);
  return [
    ...(key ? [{ id: `key\u0000${schema._type}\u0000${key}`, label: `${schema.key} "${key}"` }] : []),
    ...(schema?.singleton ? [{ id: `singleton\u0000${schema._type}`, label: `Singleton "${schema._type}"` }] : []),
    { id: `id\u0000${document._id}`, label: `_id "${document._id}"` },
    { id: `route\u0000${document._slug}`, label: `Route "${document._slug}"`, error: true },
  ];
}
