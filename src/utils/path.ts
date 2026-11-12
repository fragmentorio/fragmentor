import { bytes } from "./text.js";

/* Source paths: what a file's path says about it (its folder, extension, slug, type, ...). Pure string functions, no imports beyond text */

/* Characters that break file systems, git or URLs: control characters, Windows-reserved and URL-special ones */
const INVALID_PATH = /[\u0000-\u001f\u007f<>:"|?*#%]/;

/**
 * Normalizes any input into a canonical source path: a leading "/", "/" separators, no empty segments, NFC unicode, "_" for whitespace.
 * Harmless variants are fixed ("a\\b//c/" -> "/a/b/c", "My File.png" -> "/My_File.png"); anything ambiguous or unsafe throws, so a path can never
 * escape its folder or alias another file.
 * @throws On "." or ".." segments, an empty path, an invalid character, or a segment longer than 255 bytes.
 * @example normalize("documents\\blog//hello.md/") // "/documents/blog/hello.md"
 */
export function normalize(path: string): string {
  const segments = path.normalize("NFC").replace(/\\/g, "/").replace(/\s/g, "_").split("/").filter(Boolean);
  if (!segments.length) throw new Error("Path is empty");
  for (const segment of segments) {
    if (segment === "." || segment === "..") throw new Error(`Path can't contain "${segment}" segments: "${path}"`);
    if (INVALID_PATH.test(segment)) throw new Error(`Path contains an invalid character: "${path}"`);
    if (bytes(segment) > 255) throw new Error(`Path segment is too long: "${segment}"`);
  }
  return `/${segments.join("/")}`;
}

/**
 * Splits a file path into its extensionless, dotless path, its lowercased extension and whether it's hidden (its name starts with ".").
 * @example parse("/blog/.draft.MD") // { path: "/blog/draft", extension: "md", hidden: true }
 * @example parse("/assets/a.tar.gz") // { path: "/assets/a.tar", extension: "gz", hidden: false }
 */
export function parse(path: string): { path: string; extension: string; hidden: boolean } {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const hidden = name.startsWith(".");
  const stripped = hidden ? name.slice(1) : name;
  const dot = stripped.lastIndexOf(".");
  return {
    path: path.slice(0, slash + 1) + (dot > 0 ? stripped.slice(0, dot) : stripped),
    extension: dot > 0 ? stripped.slice(dot + 1).toLowerCase() : "",
    hidden,
  };
}

/**
 * The counterpart of `parse`: joins a path, extension and hidden flag back into a file path.
 * @example format({ path: "/blog/draft", extension: "md", hidden: true }) // "/blog/.draft.md"
 */
export function format({ path, extension, hidden }: { path: string; extension: string; hidden: boolean }): string {
  const slash = path.lastIndexOf("/");
  return `${path.slice(0, slash + 1)}${hidden ? "." : ""}${path.slice(slash + 1)}${extension ? `.${extension}` : ""}`;
}

/**
 * The top-level folder of a Source's `path`, or "" for a file at the root.
 * @example folder("/documents/blog/hello") // "documents"
 */
export function folder(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.length > 1 ? segments[0] : "";
}

/**
 * A path without its top-level `root` folder, the counterpart of `folder`.
 * @throws When the path isn't inside `root`.
 * @example inside("/documents/blog/hello.yml", "documents") // "/blog/hello.yml"
 */
export function inside(path: string, root: string): string {
  if (!path.startsWith(`/${root}/`)) throw new Error(`Expected "${path}" to be in /${root}/`);
  return path.slice(root.length + 1);
}

/**
 * The slug a file path is live at: its extension and hidden dot are dropped (see `parse`), and so is a trailing "/index",
 * since "/about/index" and "/about" serve the same page.
 * @example slug("/about/index.yml") // "/about"
 * @example slug("/blog/.draft.md") // "/blog/draft"
 * @example slug("/index") // "/"
 * @example slug("/about") // "/about"
 */
export function slug(path: string): string {
  return parse(path).path.replace(/\/index$/, "") || "/";
}

/**
 * The "/index" file path for a slug, the counterpart of `slug`. A slug can also live at the path itself
 * ("/about" may be "/about" or "/about/index"), so check which one exists when looking a file up.
 * @example path("/about") // "/about/index"
 * @example path("/") // "/index"
 * @example path("/about/index") // "/about/index"
 */
export function path(slug: string): string {
  return slug.endsWith("/index") ? slug : `${slug.replace(/\/$/, "")}/index`;
}

/**
 * The `_type` a schema or component file path names: its file name without extension, hidden dot or prefix,
 * since a component's name may be prefixed with the types it lives in ("Product.Faq" renders "Faq" inside "Product").
 * @example type("/Faq.json") // "Faq"
 * @example type("/Product.Faq.html") // "Faq"
 * @example type("/blog/.Card.html") // "Card"
 */
export function type(path: string): string {
  return parse(path).path.split("/").pop()!.split(".").pop()!;
}

/**
 * The types a component file name requires around its `_type`, outermost first: every segment before the last (see `type`).
 * @example chain("/Product.Faq.html") // ["Product"]
 * @example chain("/Page.Product.Faq.html") // ["Page", "Product"]
 * @example chain("/Faq.html") // []
 */
export function chain(path: string): string[] {
  return parse(path).path.split("/").pop()!.split(".").slice(0, -1);
}
