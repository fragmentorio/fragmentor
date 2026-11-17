import jsep from "jsep";

/*
 * Expressions are evaluated by walking a jsep AST, never via eval/new Function, so host globals (process, require, fetch)
 * are unreachable: identifiers only resolve against the data. Supported, usable in x-if, x-bind, x-bind:attr and x-for:
 *   literals "a", 1, true, null | identifiers title | members user.name, items[0] | calls title.toUpperCase()
 *   unary ! - + typeof | arithmetic + - * / % ** | comparison == != === !== < <= > >= | logical && || ?? | ternary | arrays [a, b]
 *   the top-level value being rendered (usually the page's document), from any fragment: $.site.name (so `$` is reserved, a field named "$" is unreachable)
 * Anything else (arrow functions, object literals, assignment, new, this) evaluates to undefined.
 */
/* The legacy accessors are blocked too: `x.__lookupGetter__("__proto__").call(x)` reaches Object.prototype without naming it, and `__defineGetter__` would then pollute it */
const BLOCKED = new Set(["__proto__", "constructor", "prototype", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"]);

const num = (v: unknown) => v as number;

const BINARY: Record<string, (a: unknown, b: unknown) => unknown> = {
  "+": (a, b) => num(a) + num(b),
  "-": (a, b) => num(a) - num(b),
  "*": (a, b) => num(a) * num(b),
  "/": (a, b) => num(a) / num(b),
  "%": (a, b) => num(a) % num(b),
  "**": (a, b) => num(a) ** num(b),
  "==": (a, b) => a == b,
  "!=": (a, b) => a != b,
  "===": (a, b) => a === b,
  "!==": (a, b) => a !== b,
  "<": (a, b) => num(a) < num(b),
  "<=": (a, b) => num(a) <= num(b),
  ">": (a, b) => num(a) > num(b),
  ">=": (a, b) => num(a) >= num(b),
};

const UNARY: Record<string, (a: unknown) => unknown> = {
  "!": (a) => !a,
  "-": (a) => -num(a),
  "+": (a) => +num(a),
  typeof: (a) => typeof a,
};

/*
 * Array methods that change the array in place. They're called on a copy instead, so they give the same result ("a/b".split("/").pop()
 * is still "b") without changing the data, which may be shared by every page of a build (see `render`).
 */
const MUTATING = new Set(["sort", "reverse", "splice", "push", "pop", "shift", "unshift", "fill", "copyWithin"]);

/** Reads `obj[key]`, blocking prototype escapes like `x.constructor.constructor("return process")()`. */
function member(obj: unknown, key: unknown): unknown {
  return obj == null || BLOCKED.has(String(key)) ? undefined : (obj as Record<string, unknown>)[String(key)];
}

/** Evaluates one jsep AST node against `scope`, with no fallback to real globals. Unsupported nodes are undefined. */
function node(n: jsep.Expression, scope: Record<string, unknown>): unknown {
  switch (n.type) {
    case "Literal":
      return (n as jsep.Literal).value;
    case "Identifier": {
      const { name } = n as jsep.Identifier;
      return BLOCKED.has(name) ? undefined : scope[name];
    }
    case "MemberExpression": {
      const m = n as jsep.MemberExpression;
      return member(node(m.object, scope), m.computed ? node(m.property, scope) : (m.property as jsep.Identifier).name);
    }
    case "CallExpression": {
      const c = n as jsep.CallExpression;
      const args = c.arguments.map((a) => node(a, scope));
      if (c.callee.type === "MemberExpression") {
        const m = c.callee as jsep.MemberExpression;
        const target = node(m.object, scope);
        const name = m.computed ? node(m.property, scope) : (m.property as jsep.Identifier).name;
        const obj = Array.isArray(target) && MUTATING.has(String(name)) ? [...target] : target;
        const fn = member(obj, name);
        return typeof fn === "function" ? fn.call(obj, ...args) : undefined;
      }
      const fn = node(c.callee, scope);
      return typeof fn === "function" ? fn(...args) : undefined;
    }
    case "UnaryExpression": {
      const u = n as jsep.UnaryExpression;
      return UNARY[u.operator]?.(node(u.argument, scope));
    }
    case "BinaryExpression": {
      const b = n as jsep.BinaryExpression;
      /* jsep parses &&, || and ?? as binary expressions, they short-circuit */
      if (b.operator === "&&") return node(b.left, scope) && node(b.right, scope);
      if (b.operator === "||") return node(b.left, scope) || node(b.right, scope);
      if (b.operator === "??") return node(b.left, scope) ?? node(b.right, scope);
      return BINARY[b.operator]?.(node(b.left, scope), node(b.right, scope));
    }
    case "ConditionalExpression": {
      const t = n as jsep.ConditionalExpression;
      return node(t.test, scope) ? node(t.consequent, scope) : node(t.alternate, scope);
    }
    case "ArrayExpression":
      return (n as jsep.ArrayExpression).elements.map((e) => (e ? node(e, scope) : undefined));
    default:
      return undefined;
  }
}

/*
 * Every expression parsed so far by its source (null when it doesn't parse), and whether it reads `$`: a template's few expressions
 * are evaluated thousands of times. Emptied past MAX_PARSED, so a long-running server building many projects doesn't grow it forever.
 */
const MAX_PARSED = 10_000;
const parsed = new Map<string, { ast: jsep.Expression; rooted: boolean } | null>();

/* Whether an AST reads `$` anywhere */
const roots = (n: unknown): boolean => n !== null && typeof n === "object" && ((n as jsep.Expression).type === "Identifier" ? (n as jsep.Identifier).name === "$" : Object.values(n).some(roots));

/* The parsed expression, from `parsed` after the first time */
function parse(expr: string) {
  if (!parsed.has(expr)) {
    if (parsed.size >= MAX_PARSED) parsed.clear();
    try {
      const ast = jsep(expr);
      parsed.set(expr, { ast, rooted: roots(ast) });
    } catch {
      parsed.set(expr, null);
    }
  }
  return parsed.get(expr)!;
}

/**
 * Whether an expression reads `$`, the top-level value, so its result can differ between pages that render the same data.
 * @example isRooted("$.site.name") // true
 * @example isRooted("title") // false
 */
export function isRooted(expr: string): boolean {
  return parse(expr)?.rooted ?? false;
}

/**
 * Evaluates a directive's expression against `data`, safely (see the supported grammar above).
 * @param root The top-level value being rendered (the document or fragment passed to `render`, usually a page), reachable as
 *   `$`. A fragment's own data is only its fields, so this is how it reads top-level values (e.g. `$.site.language.checkout`)
 *   without each fragment repeating them as fields.
 * @returns The value, or undefined when the expression doesn't parse or throws.
 * @example evaluate("items.length > 0 && show", { items: [1], show: true }) // true
 * @example evaluate("$.title", {}, { title: "Home" }) // "Home"
 */
export function evaluate(expr: string, data: Record<string, unknown>, root?: Record<string, unknown>): unknown {
  const expression = parse(expr);
  if (!expression) return undefined;
  try {
    return node(expression.ast, root ? { ...data, $: root } : data);
  } catch {
    return undefined;
  }
}
