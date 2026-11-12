/* The folders a project's files live in, each mapped to the extensions allowed anywhere inside it. The readers enforce this (see `within` in read.ts), and `allowed` uses it too */
export const FOLDERS = {
  documents: ["yml", "yaml", "json", "md", "html"],
  schemas: ["yml", "yaml", "json"],
  components: ["html"],
  assets: ["", "png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "ico", "pdf", "mp4", "webm", "mp3", "woff", "woff2", "ttf", "otf", "css", "js", "json", "txt", "html"],
} satisfies Record<string, string[]>;

export type Folder = keyof typeof FOLDERS;
