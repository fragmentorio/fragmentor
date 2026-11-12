/* Media types by file extension, and file type detection from a file's bytes */

/** The media type served for each extension. */
export const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css",
  js: "text/javascript",
  json: "application/json",
  xml: "application/xml",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  pdf: "application/pdf",
  woff2: "font/woff2",
  woff: "font/woff",
};

/**
 * Identifies a file's type from its bytes (not its name), as its extension: a known binary format by its leading bytes,
 * "txt" for any valid UTF-8 text without NUL bytes, or null for anything else (an unknown or unsafe binary).
 * @example extension(png) // "png"
 * @example extension(new TextEncoder().encode("# Hello")) // "txt"
 */
export function extension(data: Uint8Array): "png" | "jpg" | "gif" | "webp" | "pdf" | "txt" | null {
  const head = String.fromCharCode(...data.subarray(0, 12));
  if (head.startsWith("\x89PNG\r\n\x1a\n")) return "png";
  if (head.startsWith("\xff\xd8\xff")) return "jpg";
  if (head.startsWith("GIF8")) return "gif";
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "webp";
  if (head.startsWith("%PDF-")) return "pdf";
  try { return new TextDecoder("utf-8", { fatal: true }).decode(data).includes("\0") ? null : "txt"; } catch { return null; }
}
