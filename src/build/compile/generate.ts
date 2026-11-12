import { source } from "../source/index.js";
import { parse } from "../../utils/path.js";
import type { Source } from "../../model/types/index.js";

/* The absolute URL of a route on the site, e.g. ("https://example.com/", "/blog") -> "https://example.com/blog" */
const absolute = (url: string, route: string) => url.replace(/\/+$/, "") + encodeURI(route);

/**
 * Builds "/sitemap.xml", listing every .html file among the output files at the URL it's served at:
 * "/blog/index.html" at "/blog/", any other .html file at its own path, with its `updated_at` as `<lastmod>`. Hidden files (a leading ".") are left out.
 * @param url The site's base URL, e.g. "https://example.com".
 * @param sources The build's output files.
 * @example sitemap("https://example.com", output).data // '<?xml version="1.0" ...<loc>https://example.com/blog/</loc>...'
 */
export function sitemap(url: string, sources: Source[]): Source {
  const pages = sources.filter((s) => s.path.endsWith(".html") && !parse(s.path).hidden);
  const entries = pages.map((s) => {
    const loc = absolute(url, s.path.replace(/(^|\/)index\.html$/, "$1")).replace(/&/g, "&amp;").replace(/'/g, "&apos;");
    return `  <url><loc>${loc}</loc><lastmod>${s.updated_at}</lastmod></url>`;
  });
  return source({
    path: "/sitemap.xml",
    data: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`,
  });
}

/**
 * Stamps a page with a "Made with Fragmentor" HTML comment and optional published date, right after the doctype when there is one.
 * @param options.published When the site went live, printed in UTC.
 * @example stamp("<!doctype html><html></html>", { published: new Date("2026-11-02T10:00:00Z") })
 */
export function stamp(html: string, { published }: { published?: Date } = {}): string {
  const date = published?.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  const comment = `<!-- Made with Fragmentor - fragmentor.io -->\n${date ? `<!-- Published ${date} UTC -->\n` : ""}`;
  const doctype = /^\s*<!doctype[^>]*>\s*/i.exec(html)?.[0] ?? "";
  return `${doctype.trimEnd()}${doctype ? "\n" : ""}${comment}${html.slice(doctype.length)}`;
}

/**
 * Builds "/robots.txt", allowing every crawler and pointing it at the sitemap.
 * @param url The site's base URL, e.g. "https://example.com".
 * @example robots("https://example.com").data // "User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml\n"
 */
export function robots(url: string): Source {
  return source({ path: "/robots.txt", data: `User-agent: *\nAllow: /\n\nSitemap: ${absolute(url, "/sitemap.xml")}\n` });
}
