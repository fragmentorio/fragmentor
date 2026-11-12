import { before, test } from "node:test";
import assert from "node:assert/strict";
import { folder, parse as split, source, patch } from "../source/index.js";
import { decode } from "../decode/index.js";
import type { Schema, Source } from "../../model/types/index.js";
import { compile, type Parser } from "./index.js";
import { MAX_DEPTH } from "./render.js";
import { paths, pointers } from "./annotate.js";
import { evaluate } from "./directives.js";

/* linkedom only loads as ESM, so it's imported dynamically from this CommonJS package */
let parse: Parser;
before(async () => {
  const { parseHTML } = await import("linkedom");
  parse = (html) => parseHTML(html).document;
});
/* A document's _id is its path without extension, so references read like { _ref: "/documents/ada" } */
const file = (path: string, data: string): Source => {
  const s = source({ path, data });
  if (folder(s.path) !== "documents" || split(s.path).extension === "html" || decode({ source: s, errors: [] })._id !== undefined) return s;
  return patch(s, { $set: { _id: split(s.path).path } });
};
const build = (sources: Source[], dev = false) => compile(sources, { parse, dev });
/* Without the branding comment, which has its own test */
const page = (sources: Source[], path: string, dev = false) => build(sources, dev).output.find((s) => s.path === path)?.data?.replace(/^<!-- Made with Fragmentor - fragmentor\.io -->\n/, "");

const schemas = [
  file("schemas/page.json", JSON.stringify({ document: true, fields: { title: { type: "string" }, body: { type: "richtext" }, sections: { type: "fragments", allow: ["faq", "product"], default: [] }, author: { type: "reference", allow: ["author"], nullable: true } } })),
  file("schemas/product.json", JSON.stringify({ fields: { name: { type: "string" }, faq: { type: "fragment", allow: ["faq"], default: { _type: "faq", question: "" } } } })),
  file("schemas/faq.json", JSON.stringify({ fields: { question: { type: "string" } } })),
  file("schemas/author.json", JSON.stringify({ document: true, fields: { name: { type: "string" } } })),
];

test("compile: a page per visible document with a component, at its slug", () => {
  const sources = [
    ...schemas,
    file("components/page.html", `<h1 x-bind="title"></h1>`),
    file("documents/index.json", JSON.stringify({ _type: "page", title: "Home" })),
    file("documents/blog/index.json", JSON.stringify({ _type: "page", title: "Blog" })),
    file("documents/about.json", JSON.stringify({ _type: "page", title: "About" })),
    file("documents/.draft.json", JSON.stringify({ _type: "page", title: "Draft" })),
    file("documents/ada.json", JSON.stringify({ _type: "author", name: "Ada" })),
  ];
  const paths = build(sources).output.map((s) => s.path).sort();
  assert.deepEqual(paths, ["/about/index.html", "/blog/index.html", "/index.html"]);
  assert.equal(page(sources, "/about/index.html"), `<h1>About</h1>`);
});

test("compile: every page is branded after its doctype, with when it was published if given", () => {
  const sources = [...schemas, file("components/page.html", `<!doctype html><h1 x-bind="title"></h1>`), file("documents/index.json", JSON.stringify({ _type: "page", title: "Home" }))];
  const html = (published?: Date) => compile(sources, { parse, published }).output.find((s) => s.path === "/index.html")?.data ?? "";
  assert.match(html(), /^<!doctype html>\n<!-- Made with Fragmentor - fragmentor\.io -->\n<h1>Home<\/h1>$/i);
  assert.match(html(new Date("2026-11-02T10:00:00Z")), /^<!doctype html>\n<!-- Made with Fragmentor - fragmentor\.io -->\n<!-- Published Nov 2, 2026, 10:00 AM UTC -->\n/i);
});

test("compile: a route renders only its page", () => {
  const sources = [
    ...schemas,
    file("components/page.html", `<h1 x-bind="title"></h1>`),
    file("documents/index.json", JSON.stringify({ _type: "page", title: "Home" })),
    file("documents/blog/index.json", JSON.stringify({ _type: "page", title: "Blog" })),
  ];
  assert.deepEqual(compile(sources, { parse, route: "/blog" }).output.map((s) => s.path), ["/blog/index.html"]);
  assert.deepEqual(compile(sources, { parse, route: "/" }).output.map((s) => s.path), ["/index.html"]);
});

test("compile: _slug is the page's route while rendering", () => {
  const sources = [
    ...schemas,
    file("components/page.html", `<a x-bind:href="_slug"></a>`),
    file("documents/index.json", JSON.stringify({ _type: "page" })),
    file("documents/blog/index.json", JSON.stringify({ _type: "page" })),
  ];
  assert.equal(page(sources, "/index.html"), `<a href="/"></a>`);
  assert.equal(page(sources, "/blog/index.html"), `<a href="/blog"></a>`);
});

test("compile: references are resolved before rendering", () => {
  const sources = [
    ...schemas,
    file("components/page.html", `<p x-bind="author.name"></p>`),
    file("documents/ada.json", JSON.stringify({ _type: "author", name: "Ada" })),
    file("documents/post.json", JSON.stringify({ _type: "page", author: { _ref: "/documents/ada" } })),
  ];
  assert.equal(page(sources, "/post/index.html"), `<p>Ada</p>`);
});

test("compile: a text field keeps its runs and their marks, an invalid one falls back to its default", () => {
  const sources = [
    file("schemas/page.json", JSON.stringify({ document: true, fields: { title: { type: "text", default: [{ _type: "text", text: "Untitled" }] } } })),
    file("components/page.html", `<h1 x-bind="title"></h1>`),
    file("documents/index.json", JSON.stringify({ _type: "page", title: [{ _type: "text", text: "a < " }, { _type: "text", text: "Hi", bold: true }] })),
    file("documents/broken.json", JSON.stringify({ _type: "page", title: "Hi" })),
  ];
  assert.equal(page(sources, "/index.html"), `<h1>a &lt; <strong>Hi</strong></h1>`);
  assert.equal(page(sources, "/broken/index.html"), `<h1>Untitled</h1>`);
});

test("compile: $ is the top-level document being rendered, from itself, a nested fragment and an x-for item", () => {
  const sources = [
    ...schemas,
    file("components/page.html", `<h1 x-bind="$.title"></h1><main x-bind="sections"></main>`),
    file("components/faq.html", `<p x-bind="question + ' on ' + $.title"></p>`),
    file("components/product.html", `<ul><li x-for="[faq]"><span x-bind:title="$.title" x-bind="question"></span></li></ul>`),
    file("documents/index.json", JSON.stringify({ _type: "page", title: "Home", sections: [{ _type: "faq", question: "Why" }, { _type: "product", name: "P", faq: { _type: "faq", question: "How" } }] })),
  ];
  assert.equal(page(sources, "/index.html"), `<h1>Home</h1><main><p>Why on Home</p><ul><li><span title="Home">How</span></li></ul></main>`);
});

test("compile: directives inside a <template> get the same data, $ included", () => {
  const sources = [
    ...schemas,
    file("components/page.html", `<ul><template><li><b x-bind="title"></b><i x-if="!title"></i><button x-bind:aria-label="$.title"></button></li></template></ul>`),
    file("documents/index.json", JSON.stringify({ _type: "page", title: "Home" })),
  ];
  assert.equal(page(sources, "/index.html"), `<ul><template><li><b>Home</b><button aria-label="Home"></button></li></template></ul>`);
});

test("compile: a reference back to the page resolves too, e.g. a menu listing the page it's on", () => {
  const sources = [
    file("schemas/page.json", JSON.stringify({ document: true, fields: { title: { type: "string" }, menu: { type: "reference", allow: ["navigation"], nullable: true } } })),
    file("schemas/navigation.json", JSON.stringify({ document: true, fields: { links: { type: "references", allow: ["page"] } } })),
    file("components/page.html", `<nav><span x-for="menu.links"><a x-bind:href="_slug" x-bind="title"></a></span></nav>`),
    file("documents/navigation.json", JSON.stringify({ _type: "navigation", links: [{ _ref: "/documents/about" }, { _ref: "/documents/contact" }] })),
    file("documents/about.json", JSON.stringify({ _type: "page", title: "About", menu: { _ref: "/documents/navigation" } })),
    file("documents/contact.json", JSON.stringify({ _type: "page", title: "Contact", menu: { _ref: "/documents/navigation" } })),
  ];
  const nav = `<nav><span><a href="/about">About</a></span><span><a href="/contact">Contact</a></span></nav>`;
  assert.equal(page(sources, "/about/index.html"), nav);
  assert.equal(page(sources, "/contact/index.html"), nav);
});

test("compile: a component rendering itself through a reference loop stops at MAX_DEPTH", () => {
  const sources = [
    file("schemas/page.json", JSON.stringify({ document: true, fields: { title: { type: "string" }, next: { type: "reference", allow: ["page"], nullable: true } } })),
    file("components/page.html", `<p x-bind="title"></p><div x-bind="next"></div>`),
    file("documents/loop.json", JSON.stringify({ _type: "page", title: "Loop", next: { _ref: "/documents/loop" } })),
  ];
  const { output, errors } = build(sources);
  const html = output.find((s) => s.path === "/loop/index.html")?.data ?? "";
  assert.deepEqual(errors, []);
  assert.equal(html.match(/<p>Loop<\/p>/g)?.length, MAX_DEPTH);
  assert.ok(html.includes("<!-- too deep: page -->"));
});

test("compile: the most specific component wins inside its ancestors", () => {
  const sources = [
    ...schemas,
    file("components/page.html", `<main x-bind="sections"></main>`),
    file("components/product.html", `<section x-bind="faq"></section>`),
    file("components/faq.html", `<p x-bind="question"></p>`),
    file("components/product.faq.html", `<details x-bind="question"></details>`),
    file("documents/index.json", JSON.stringify({ _type: "page", sections: [{ _type: "faq", question: "A" }, { _type: "product", name: "P", faq: { _type: "faq", question: "B" } }] })),
  ];
  assert.equal(page(sources, "/index.html"), `<main><p>A</p><section><details>B</details></section></main>`);
});

test("compile: reserved fragments without a component render as their tag, with text escaped", () => {
  const body = [
    { _type: "p", children: [{ _type: "text", text: "a < b", bold: true }, { _type: "a", href: "/x", children: [{ _type: "text", text: "link", underline: true }] }] },
    { _type: "p", children: [] },
    { _type: "img", src: "/logo.png", alt: "Logo" },
  ];
  const sources = [
    ...schemas,
    file("components/page.html", `<article x-bind="body"></article>`),
    file("documents/index.json", JSON.stringify({ _type: "page", body })),
  ];
  assert.equal(page(sources, "/index.html"), `<article><p><strong>a &lt; b</strong><a href="/x"><u>link</u></a></p><p></p><img src="/logo.png" alt="Logo"></article>`);
});

test("compile: a project component overrides a reserved type", () => {
  const sources = [
    ...schemas,
    file("components/page.html", `<article x-bind="body"></article>`),
    file("components/p.html", `<div class="p" x-bind="children"></div>`),
    file("documents/index.json", JSON.stringify({ _type: "page", body: [{ _type: "p", children: [{ _type: "text", text: "Hi" }] }] })),
  ];
  assert.equal(page(sources, "/index.html"), `<article><div class="p">Hi</div></article>`);
});

test("compile: styles and scripts are extracted once into /_styles/ and /_scripts/ and linked", () => {
  const sources = [
    ...schemas,
    file("components/page.html", `<html><head></head><body><main x-bind="sections"></main></body></html>`),
    file("components/faq.html", `<p x-bind="question"></p><style>p { color: red }</style><script>console.log(1)</script>`),
    file("documents/index.json", JSON.stringify({ _type: "page", sections: [{ _type: "faq", question: "A" }, { _type: "faq", question: "B" }] })),
  ];
  const { output } = build(sources);
  const assets = output.filter((s) => /^\/_(styles|scripts)\//.test(s.path));
  assert.deepEqual(assets.map((s) => `${s.path.split("/")[1]}.${split(s.path).extension}`).sort(), ["_scripts.js", "_styles.css"]);
  const html = page(sources, "/index.html")!;
  for (const asset of assets) assert.ok(html.includes(`"${asset.path}"`));
  assert.ok(!html.includes("<style>"));
});

test("compile: a page's styles are joined into one stylesheet, in render order", () => {
  const sources = [
    ...schemas,
    file("components/page.html", `<html><head></head><body><main x-bind="sections"></main><style>main { margin: 0 }</style></body></html>`),
    file("components/faq.html", `<p x-bind="question"></p><style>p { color: red }</style>`),
    file("documents/index.json", JSON.stringify({ _type: "page", sections: [{ _type: "faq", question: "A" }] })),
  ];
  const css = build(sources).output.filter((s) => s.path.endsWith(".css"));
  assert.equal(css.length, 1);
  assert.equal(css[0].data, "main { margin: 0 }\np { color: red }");
  assert.equal(page(sources, "/index.html")!.match(/rel="stylesheet"/g)?.length, 1);
});

test("compile: data blocks like application/ld+json stay in the page", () => {
  const ld = `<script type="application/ld+json">{"@type":"Product"}</script>`;
  const sources = [
    ...schemas,
    file("components/page.html", `<html><head></head><body>${ld}<script type="module">console.log(1)</script></body></html>`),
    file("documents/index.json", JSON.stringify({ _type: "page" })),
  ];
  const { output } = build(sources);
  assert.deepEqual(output.filter((s) => /^\/_(styles|scripts)\//.test(s.path)).map((s) => split(s.path).extension), ["js"]);
  assert.ok(page(sources, "/index.html")!.includes(ld));
});

test("compile: assets are passed through and win over a page at the same path", () => {
  const sources = [
    ...schemas,
    file("components/page.html", `<h1 x-bind="title"></h1>`),
    file("documents/about.json", JSON.stringify({ _type: "page", title: "About" })),
    file("assets/about/index.html", "static"),
    file("assets/images/logo.svg", "<svg/>"),
  ];
  assert.equal(page(sources, "/about/index.html"), "static");
  assert.equal(page(sources, "/images/logo.svg"), "<svg/>");
});

test("compile: an asset with an extension assets can't have is left out, with an error", () => {
  const { output, errors } = build([file("assets/logo.svg", "<svg/>"), file("assets/tool.exe", "x")]);
  assert.deepEqual(output.map((s) => s.path), ["/logo.svg"]);
  assert.deepEqual(errors.map((e) => e.path), ["/assets/tool.exe"]);
});

test("compile: dev renders hidden documents too", () => {
  const sources = [
    ...schemas,
    file("components/page.html", `<h1 x-bind="title"></h1>`),
    file("documents/blog/.draft.json", JSON.stringify({ _type: "page", title: "Draft" })),
  ];
  assert.equal(page(sources, "/blog/draft/index.html"), undefined);
  assert.equal(page(sources, "/blog/draft/index.html", true), `<h1 x-src="page:1:0">Draft</h1>`);
});

test("compile: hidden documents can't be referenced, except in dev", () => {
  const sources = [
    ...schemas,
    file("components/page.html", `<p x-bind="author.name"></p>`),
    file("documents/.ada.json", JSON.stringify({ _type: "author", name: "Ada" })),
    file("documents/post.json", JSON.stringify({ _type: "page", author: { _ref: "/documents/ada" } })),
  ];
  assert.equal(page(sources, "/post/index.html"), `<p></p>`);
  assert.equal(page(sources, "/post/index.html", true), `<p x-src="page:1:0">Ada</p>`);
});

test("compile: hidden components and schemas are ignored, hidden assets are published as is", () => {
  const sources = [
    file("schemas/.page.json", JSON.stringify({ document: true, fields: { title: { type: "string" } } })),
    file("components/.page.html", `<h1 x-bind="title"></h1>`),
    file("documents/index.json", JSON.stringify({ _type: "page", title: "Home" })),
    file("assets/.nojekyll", ""),
  ];
  assert.deepEqual(build(sources).output.map((s) => s.path), ["/.nojekyll"]);
});

test("compile: dev adds x-src, x-path, and x-type/x-allow from the field's schema", () => {
  const sources = [
    ...schemas,
    file("components/page.html", `<main x-bind="sections"></main>`),
    file("components/product.html", `<div x-bind="faq"></div>`),
    file("components/faq.html", `<p x-bind="question"></p>`),
    file("documents/index.json", JSON.stringify({ _type: "page", sections: [{ _type: "product", faq: { _type: "faq", question: "A" } }] })),
  ];
  /* An array item, then a single fragment field (linkedom serializes attributes set later first) */
  assert.equal(
    page(sources, "/index.html", true),
    `<main x-src="page:1:0"><div x-allow="faq product" x-type="product" x-path="sections.0" x-src="product:1:0"><p x-allow="faq" x-type="faq" x-path="sections.0.faq" x-src="faq:1:0">A</p></div></main>`
  );
});

test("compile: dev stamps where a fragment lives, however the template reached it ($., references)", () => {
  const sources = [
    file("schemas/page.json", JSON.stringify({ document: true, fields: { site: { type: "reference", allow: ["site"] } } })),
    file("schemas/site.json", JSON.stringify({ document: true, fields: { links: { type: "fragments", allow: ["faq"], default: [] } } })),
    file("schemas/faq.json", JSON.stringify({ fields: { question: { type: "string" } } })),
    file("components/page.html", `<footer x-bind="$.site"></footer>`),
    file("components/site.html", `<nav x-bind="links"></nav>`),
    file("components/faq.html", `<p x-bind="question"></p>`),
    file("documents/site.json", JSON.stringify({ _type: "site", links: [{ _type: "faq", question: "A" }] })),
    file("documents/index.json", JSON.stringify({ _type: "page", site: { _ref: "/documents/site" } })),
  ];
  assert.equal(
    page(sources, "/index.html", true),
    `<footer x-src="page:1:0"><nav x-allow="site" x-type="site" x-path="site" x-src="site:1:0"><p x-allow="faq" x-type="faq" x-path="site.links.0" x-src="faq:1:0">A</p></nav></footer>`
  );
});

test("paths: every object's field path, the shortest when it's reachable several ways", () => {
  const hero = { _type: "hero" };
  const site: Record<string, unknown> = { _type: "site", footer: { _type: "footer", hero } };
  site.self = site; /* a loop, as resolved references can make */
  const found = paths({ _type: "page", site, sections: [hero] });
  assert.deepEqual(found.get(hero), ["sections", "0"]);
  assert.deepEqual(found.get(site), ["site"]);
});

test("pointers: x-type/x-allow only when schemas describe the field", () => {
  const types = [
    { _type: "page", fields: { sections: { type: "fragments", allow: ["hero", "cta"] }, hero: { type: "fragment", allow: ["hero"] } } },
  ] as unknown as Schema[];
  const document = { _type: "page", sections: [{ _type: "cta" }], hero: { _type: "hero" }, other: { _type: "hero" } };
  assert.deepEqual(pointers(document, ["sections", "0"], types), { "x-path": "sections.0", "x-type": "cta", "x-allow": "hero cta" });
  assert.deepEqual(pointers(document, ["hero"], types), { "x-path": "hero", "x-type": "hero", "x-allow": "hero" });
  assert.deepEqual(pointers(document, ["other"], types), { "x-path": "other" }); /* no such field */
  assert.deepEqual(pointers(document, ["sections", "0"]), { "x-path": "sections.0" }); /* no schemas */
  assert.deepEqual(pointers(document, [], types), {}); /* the root */
});

test("compile: invalid files are reported without breaking the build", () => {
  const sources = [
    ...schemas,
    file("components/page.html", `<h1 x-bind="title"></h1>`),
    file("components/broken.txt", "not html"),
    file("documents/settings.json", JSON.stringify({ theme: "dark" })),
    file("documents/index.json", JSON.stringify({ _type: "page", title: "Home" })),
  ];
  const { output, errors } = build(sources);
  assert.deepEqual(errors.map((e) => e.path), ["/components/broken.txt"]);
  assert.equal(output.length, 1);
});


test("compile: script urls never reach a link or a bound url attribute, however they're spelled", () => {
  const sources = [
    ...schemas,
    file("schemas/card.json", JSON.stringify({ document: true, fields: { title: { type: "string" }, href: { type: "string" }, children: { type: "richtext" } } })),
    file("components/card.html", `<a x-bind:href="href" x-bind:title="title">x</a><div x-bind="children"></div>`),
    file("documents/index.md", `---\n_type: card\n_id: home\ntitle: "javascript:ok"\nhref: "JavaScript:alert(1)"\n---\n\n[a](javascript:alert(2)) [b](java&#x09;script&#58;alert(3)) [c](/safe#ok) [d](mailto:a@b.co)\n\n<a href="javascript&colon;alert(4)">e</a>\n`),
  ];
  const html = page(sources, "/index.html")!;
  assert.doesNotMatch(html, /javascript:alert|script&#58;/i);
  assert.match(html, /<a title="javascript:ok">x<\/a>/);
  assert.match(html, /href="\/safe#ok"/);
  assert.match(html, /href="mailto:a@b.co"/);
});

test("evaluate: expressions can't reach or pollute Object.prototype, nor the Function constructor", () => {
  const x = {};
  for (const expr of [
    `x.__lookupGetter__("__proto__").call(x)`,
    `x["__lookup" + "Getter__"]("__proto__").call(x)`,
    `x.__defineGetter__.call(x, "polluted", x.valueOf)`,
    `x.constructor`, `x["constr" + "uctor"]`, `x.__proto__`, `x.toString.constructor("return process")()`,
  ]) assert.equal(evaluate(expr, { x }), undefined, expr);
  assert.equal("polluted" in {}, false);
  assert.equal(evaluate(`title.toUpperCase()`, { title: "hi" }), "HI");
});

test("compile: x-bind:attr on an x-for element reads each item, x-if there reads the outer scope", () => {
  const sources = [
    ...schemas,
    file("components/page.html", `<ul><li x-for="sections" x-if="title" x-bind:data-q="question" x-bind:title="$.title"></li></ul><p x-for="sections[0]" x-bind:id="question"></p>`),
    file("documents/index.json", JSON.stringify({ _type: "page", title: "Home", sections: [{ _type: "faq", question: "A" }, { _type: "faq", question: "B" }] })),
  ];
  assert.equal(page(sources, "/index.html"), `<ul><li title="Home" data-q="A"></li><li title="Home" data-q="B"></li></ul><p id="A"></p>`);
});
