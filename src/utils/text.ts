/** The UTF-8 byte length of a string, which is what file sizes and limits count (not its `.length` in UTF-16 units). */
export function bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** `count` and `word`, with an "s" unless it's exactly one: plural(1, "page") -> "1 page", plural(3, "page") -> "3 pages". */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * Applies a line-range patch to a text body. Keys are `"12"` (one line) or `"12:15"` (inclusive
 * range), 1-indexed against the *original* line numbering; the value replaces those lines, or
 * `null` deletes them. Every range resolves against the original numbering in a single pass, so an
 * earlier edit never shifts a later one. A value may contain newlines, which is how you grow a file,
 * and line `N+1` of an N-line file is a valid pure append.
 * @param text The text to patch.
 * @param patch Line ranges to replacement text, or `null` to delete those lines.
 * @throws On a malformed key, an out-of-bounds line, or two overlapping ranges.
 * @example lines("a\nb\nc", { "2": "B", "3": null }) // "a\nB"
 */
export function lines(text: string, patch: Record<string, string | null>): string {
  const src = text.split("\n");
  const ranges = Object.entries(patch).map(([key, value]) => {
    const m = /^(\d+)(?::(\d+))?$/.exec(key.trim());
    if (!m) throw new Error(`Invalid line range "${key}". Use "12" for one line or "12:15" for a range.`);
    const start = Number(m[1]), end = m[2] ? Number(m[2]) : start;
    if (start < 1 || end < start || end > src.length + 1) throw new Error(`Line range "${key}" is out of bounds - the file has ${src.length} lines.`);
    return { start, end, value };
  }).sort((a, b) => a.start - b.start);

  const out: string[] = [];
  let i = 0; /* 0-indexed cursor into src */
  for (const { start, end, value } of ranges) {
    if (start - 1 < i) throw new Error(`Line ranges overlap at line ${start}. Send overlapping edits as separate calls.`);
    out.push(...src.slice(i, start - 1), ...(value === null ? [] : [value]));
    i = end;
  }
  return [...out, ...src.slice(i)].join("\n");
}
