/* Colors for the CLI's problems: errors red, warnings orange. Only on a terminal, and never with NO_COLOR set (https://no-color.org) */

const enabled = (stream: NodeJS.WriteStream) => Boolean(stream.isTTY) && !process.env["NO_COLOR"];

const paint = (code: string, text: string, stream: NodeJS.WriteStream) => (enabled(stream) ? `\x1b[${code}m${text}\x1b[0m` : text);

/** Text in red, for stderr. */
export const red = (text: string) => paint("31", text, process.stderr);

/** Text in orange (256-color 208, which terminals without it show as their closest color), for stderr. */
export const orange = (text: string) => paint("38;5;208", text, process.stderr);

/** Prints an error in red. */
export const error = (message: string) => console.error(red(message));

/** Prints a warning in orange. */
export const warn = (message: string) => console.warn(orange(message));
