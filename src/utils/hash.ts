/* Content hashes, to name content-addressed files and remember what was seen. Both run in Node and the browser */

/**
 * Hashes a string with FNV-1a into a stable 8 character hex digest: fast and synchronous, for naming files, not for security.
 * @example hash("body { margin: 0 }") // "aaec60e7"
 */
export function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** A SHA-256 of a string (as UTF-8) or of bytes, in hex: 64 characters whatever the input's size. */
export async function sha256(data: string | Uint8Array): Promise<string> {
  const input = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", input as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
