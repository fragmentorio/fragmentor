import type * as z from "zod";

/* How problems are reported everywhere: with an `errors`/`warnings` array they're collected (reads, the editor), without one an error throws (writes) */

/**
 * Reports an error. Throws when no `errors` array is given, otherwise records the message and returns `value`.
 * @example return error(`Expected string, got ${typeof input}`, field.default, errors);
 */
export function error<T>(message: string, value: T, errors?: string[]): T {
  if (!errors) throw new Error(message);
  errors.push(message);
  return value;
}

/**
 * Reports a warning. Records the message when a `warnings` array is given, and returns `value`.
 * @example return warning(`Number ${input} exceeds maximum ${field.max}`, input, warnings);
 */
export function warning<T>(message: string, value: T, warnings?: string[]): T {
  warnings?.push(message);
  return value;
}

/** Runs a Zod schema's safeParse and flattens the result to { data, error }, with error as the first issue in "path: message" form (or just "message" if the issue has no path). */
export function safeParse<T>(schema: z.ZodType<T>, value: unknown): { data: T; error: null } | { data: null; error: string } {
  const result = schema.safeParse(value);
  if (result.success) return { data: result.data, error: null };
  const issue = result.error.issues[0];
  const path = issue.path.join(".");
  return { data: null, error: path ? `${path}: ${issue.message}` : issue.message };
}
