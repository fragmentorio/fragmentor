import { SCRIPTS } from "../compile/assets.js";
import type { Parser } from "../compile/render.js";
import { sha256 } from "../../utils/hash.js";

type Sharp = typeof import("sharp").default;

/* Where image variants are served from. Named after their bytes' hash, so they're cached forever like /_styles and /_scripts */
export const IMAGES = "/_images";

/* The widths every image is encoded at, capped at its own width (never upscaled) */
const WIDTHS = [640, 1280, 1920];

/* Images worth re-encoding. GIF (animation), SVG (vector) and ICO stay as they are */
const RASTER = /\.(png|jpe?g|webp)$/i;

/* Text files esbuild minifies, except ones that already are (e.g. "/vendor/htmx.min.js") */
const MINIFIABLE = /\.(css|m?js)$/i;
const MINIFIED = /\.min\.(css|m?js)$/i;

/* An output file: text, bytes, or null for a binary whose bytes live elsewhere (see `read`) */
type File = string | Buffer | null;

const text = (data: string | Buffer) => (typeof data === "string" ? data : data.toString("utf8"));

/* `content` in the type `data` came in, so a caller gets back what it passed */
const same = <T extends File>(data: T, content: string) => (typeof data === "string" ? content : Buffer.from(content)) as T | Buffer;

/** The output path an `<img src>` points at when it's on the site itself, decoded and without query ("/images/a%20b.png?v=2" -> "/images/a b.png"), else null. */
function local(src: string | null): string | null {
  if (!src?.startsWith("/") || src.startsWith("//")) return null;
  try {
    return decodeURI(src.split(/[?#]/)[0]);
  } catch {
    return null;
  }
}

/**
 * Encodes an image into WebP at each of WIDTHS, capped at its own width, named after its bytes' hash ("/_images/<hash>-640.webp").
 * EXIF rotation is applied and metadata (e.g. GPS) stripped. An animated image is left alone, since WebP variants would keep only its first frame.
 * @returns Each variant's path, width and bytes, narrowest first, or [] for an animated image. Throws on bytes that aren't an image.
 */
async function variants(sharp: Sharp, bytes: Buffer): Promise<{ path: string; width: number; data: Buffer }[]> {
  const meta = await sharp(bytes).metadata();
  if ((meta.pages ?? 1) > 1) return [];
  const width = meta.autoOrient?.width ?? meta.width;
  const name = (await sha256(bytes)).slice(0, 8);
  const widths = [...new Set(WIDTHS.map((w) => Math.min(w, width)))];
  return Promise.all(widths.map(async (w) => ({ path: `${IMAGES}/${name}-${w}.webp`, width: w, data: await sharp(bytes).rotate().resize(w).webp({ quality: 80 }).toBuffer() })));
}

/**
 * Optimizes a built site for page speed (Lighthouse), after `compile` in every build but dev. Swap this function out to change the whole procedure.
 * 1. Minifies every .css and .js file with esbuild, except ".min." ones. A "/_scripts" file is always loaded as a module, so its names are shortened too.
 *    Any other script may be a classic one whose top-level names are globals (`onclick="openMenu()"`), so those are kept.
 * 2. Encodes every PNG, JPEG and WebP an `<img src>` points at into WebP variants (see `variants`), and points that `<img>` at them with a `srcset`.
 *    An `<img>` with its own `srcset` or inside a `<picture>` keeps its sources. The original file stays, for anything else pointing at it (og:image, CSS, ...).
 * 3. Gives every `<img>` loading hints: the page's first one `fetchpriority="high"` (likely its largest paint), every other one `loading="lazy"` and
 *    `decoding="async"`, and `sizes` along with a `srcset` ("auto" for a lazy one, so it picks by its rendered width). An attribute already set is kept.
 * esbuild and sharp are optional: without one, its step is skipped with a warning. A file that fails is kept as is with a warning, so nothing fails a build.
 * A page without images is left untouched, any other one is reserialized by `parse`.
 * @param files Every output file by path: text, bytes, or null for a binary whose bytes live elsewhere.
 * @param options.parse Parses a page's HTML (linkedom).
 * @param options.read Reads a null file's bytes (e.g. from storage), by its output path.
 * @returns The files, each in the type it came in, plus every image variant as bytes, and a warning per skipped step or failed file.
 * @example await optimize({ "/index.html": '<img src="/logo.png">', "/logo.png": bytes }, { parse }) // { files: { "/index.html": '<img src="/_images/<hash>-640.webp" srcset="/_images/<hash>-640.webp 640w" fetchpriority="high" sizes="100vw">', "/_images/<hash>-640.webp": <Buffer>, ... }, warnings: [] }
 */
export async function optimize<T extends File>(files: Record<string, T>, { parse, read }: { parse: Parser; read?: (path: string) => Promise<Buffer> }): Promise<{ files: Record<string, T | Buffer>; warnings: string[] }> {
  const out: Record<string, T | Buffer> = { ...files };
  const warnings: string[] = [];
  const esbuild = await import("esbuild").catch(() => null);
  const sharp = await import("sharp").then((m) => m.default).catch(() => null);
  if (!esbuild) warnings.push("esbuild isn't installed, so CSS and JS aren't minified");
  if (!sharp) warnings.push("sharp isn't installed, so images aren't optimized");

  for (const [path, data] of Object.entries(files)) {
    if (!esbuild || data === null || !MINIFIABLE.test(path) || MINIFIED.test(path)) continue;
    const css = /\.css$/i.test(path);
    try {
      const { code } = await esbuild.transform(text(data), { loader: css ? "css" : "js", minify: true, format: path.startsWith(`${SCRIPTS}/`) ? "esm" : undefined });
      out[path] = same(data, code);
    } catch (e) {
      warnings.push(`${path}: not minified, ${(e as Error).message}`);
    }
  }

  /* Each image's variants by its path, encoded once however many pages show it. One at a time, since a large photo takes a lot of memory to decode */
  const encoded = new Map<string, { path: string; width: number }[]>();
  for (const [path, data] of Object.entries(files)) {
    if (data === null || !/\.html$/i.test(path)) continue;
    const document = parse(text(data));
    const images = [...document.querySelectorAll("img")];
    if (!images.length) continue;
    const pictured = new Set(document.querySelectorAll("picture img"));

    for (const [i, img] of images.entries()) {
      if (i === 0 && img.getAttribute("loading") === null && img.getAttribute("fetchpriority") === null) img.setAttribute("fetchpriority", "high");
      if (i > 0 && img.getAttribute("loading") === null) img.setAttribute("loading", "lazy");
      if (i > 0 && img.getAttribute("decoding") === null) img.setAttribute("decoding", "async");

      const src = local(img.getAttribute("src"));
      if (!sharp || !src || !RASTER.test(src) || !(src in files) || img.getAttribute("srcset") !== null || pictured.has(img)) continue;
      let list = encoded.get(src);
      if (!list) {
        try {
          const stored = files[src];
          const bytes = Buffer.isBuffer(stored) ? stored : stored === null && read ? await read(src) : null;
          const encodings = bytes ? await variants(sharp, bytes) : [];
          for (const variant of encodings) if (!(variant.path in out)) out[variant.path] = variant.data;
          list = encodings;
        } catch (e) {
          warnings.push(`${src}: not optimized, ${(e as Error).message}`);
          list = [];
        }
        encoded.set(src, list);
      }
      if (!list.length) continue;
      img.setAttribute("src", list[list.length - 1].path);
      img.setAttribute("srcset", list.map((v) => `${v.path} ${v.width}w`).join(", "));
      if (img.getAttribute("sizes") === null) img.setAttribute("sizes", img.getAttribute("loading") === "lazy" ? "auto, 100vw" : "100vw");
    }
    out[path] = same(data, document.toString());
  }

  return { files: out, warnings };
}
