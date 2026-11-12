import { test } from "node:test";
import assert from "node:assert/strict";
import { source, read, patch } from "../../build/source/index.js";
import { decode } from "../../build/decode/index.js";
import { pull } from "./index.js";
import type { Schema, Source, Pull } from "../../model/types/index.js";

/* Gives a document file an _id when it has none, as every document needs one */
const identify = (s: Source) => decode({ source: s })._id === undefined ? patch(s, { $set: { _id: crypto.randomUUID() } }) : s;
const file = (path: string, data: string) => source({ path, data });
const fields = { slug: { type: "string", nullable: true, immutable: true, default: null }, title: { type: "string", default: "" }, price: { type: "number", default: 0 }, cover: { type: "image", default: { _type: "img", src: "", alt: "" } } };
const schema = (spec: Partial<Pull>, extra: Record<string, unknown> = {}): Schema =>
  read.schema({ source: file("schemas/product.json", JSON.stringify({ document: true, path: "/products", key: "slug", fields, pull: { request: { url: "https://api.test/items" }, select: "response.body.items", ...spec }, ...extra })) })!;

/* A fake fetch answering each request with `respond`, recording every request it got */
function fake(respond: (url: URL, init: RequestInit, n: number) => Response | unknown) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url: new URL(url), init });
    const res = respond(new URL(url), init, calls.length - 1);
    return res instanceof Response ? res : new Response(JSON.stringify(res));
  };
  return { fetch, calls };
}

const fieldsOf = (s: Source) => decode({ source: s });

test("pull: offset pagination fetches until an empty page and creates a .yml per key", async () => {
  const pages = [[{ slug: "a", title: "A", price: 1 }, { slug: "b", title: "B" }], [{ slug: "c", title: "C" }], []];
  const { fetch, calls } = fake((url) => ({ items: pages[Number(url.searchParams.get("offset")) / 2] }));
  const s = schema({ request: { url: "https://api.test/items?limit=2&offset={{offset}}" }, init: { offset: "0" }, next: { offset: "offset + 2" } });

  const { pulled: out } = await pull({ schema: s, schemas: [s], sources: [], fetch });
  assert.deepEqual(calls.map((c) => c.url.searchParams.get("offset")), ["0", "2", "4"]);
  assert.deepEqual(out.map((o) => o.path), ["/documents/products/a.yml", "/documents/products/b.yml", "/documents/products/c.yml"]);
  const a = fieldsOf(out[0]);
  assert.equal(a._type, "product");
  assert.equal(typeof a._id, "string");
  assert.equal(a.title, "A");
  assert.equal(a.price, 1);
  assert.equal(fieldsOf(out[1]).price, 0, "unmapped fields keep the schema default");
});

test("pull: a cursor in a POST body is left out until there is one, and a null cursor stops", async () => {
  const pages = [{ results: [{ slug: "a" }], next_cursor: "c1" }, { results: [{ slug: "b" }], next_cursor: null }];
  const { fetch, calls } = fake((_, __, n) => pages[n]);
  const s = schema({
    request: { url: "https://api.test/query", headers: { Authorization: "Bearer {{token}}" }, body: { page_size: 100, start_cursor: "{{cursor}}" } },
    init: { token: "'secret'" },
    select: "response.body.results",
    next: { cursor: "response.body.next_cursor" },
  });

  await pull({ schema: s, schemas: [s], sources: [], fetch });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual((calls[0].init.headers as Record<string, string>).authorization, "Bearer secret");
  assert.deepEqual(JSON.parse(calls[0].init.body as string), { page_size: 100 });
  assert.deepEqual(JSON.parse(calls[1].init.body as string), { page_size: 100, start_cursor: "c1" });
});

test("pull: context loads the first document of its type into the scope, init overrides it", async () => {
  const { fetch, calls } = fake(() => ({ items: [] }));
  const settings = file("documents/settings.yml", "_type: settings\n_id: s1\ntoken: secret\nbase: ctx\n");
  const ctx = read.schema({ source: file("schemas/settings.json", JSON.stringify({ document: true, singleton: true, fields: { token: { type: "string", default: "" }, base: { type: "string", default: "" } } })) })!;
  const s = schema({ request: { url: "https://api.test/{{base}}", headers: { Authorization: "Bearer {{token}}" } }, context: "settings", init: { base: "'init'" } });

  await pull({ schema: s, schemas: [s, ctx], sources: [settings], fetch }).catch(() => {});
  assert.equal(calls[0].url.pathname, "/init");
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, "Bearer secret");

  /* A missing document and an invalid value both fall back to the schema's defaults */
  await pull({ schema: s, schemas: [s, ctx], sources: [], fetch }).catch(() => {});
  assert.equal((calls[1].init.headers as Record<string, string>).authorization, "Bearer ");
  await pull({ schema: s, schemas: [s, ctx], sources: [file("documents/settings.yml", "_type: settings\n_id: s1\ntoken: 5\n")], fetch }).catch(() => {});
  assert.equal((calls[2].init.headers as Record<string, string>).authorization, "Bearer ");
  await assert.rejects(pull({ schema: { ...s, pull: { ...s.pull!, context: "nope" } }, schemas: [s], sources: [], fetch }), /context "nope" isn't a schema/);
});

test("pull: a query param whose placeholder resolves to nothing is dropped", async () => {
  const { fetch, calls } = fake((_, __, n) => (n === 0 ? { records: [{ slug: "a" }], offset: "o1" } : { records: [{ slug: "b" }] }));
  const s = schema({ request: { url: "https://api.test/{{base}}/t?pageSize=100&offset={{offset}}" }, init: { base: "'app 1'" }, select: "response.body.records", next: { offset: "response.body.offset" } });

  await pull({ schema: s, schemas: [s], sources: [], fetch });
  assert.equal(calls[0].url.pathname, "/app%201/t");
  assert.equal(calls[0].url.searchParams.has("offset"), false);
  assert.equal(calls[1].url.searchParams.get("offset"), "o1");
});

test("pull: map builds fields from expressions, dot keys build nested values", async () => {
  const { fetch } = fake(() => ({ items: [{ id: "gid://shop/Product/7", name: "Shirt", cost: { amount: "9.5" } }] }));
  const s = schema({ map: { slug: "id.split('/').pop()", title: "name.toUpperCase()", price: "+cost.amount" } });

  const { pulled: [out] } = await pull({ schema: s, schemas: [s], sources: [], fetch });
  assert.equal(out.path, "/documents/products/7.yml");
  assert.equal(fieldsOf(out).title, "SHIRT");
  assert.equal(fieldsOf(out).price, 9.5);
});

test("pull: values are coerced into their field's type", async () => {
  const typed = { slug: { type: "string", nullable: true, immutable: true, default: null }, title: { type: "string", default: "" }, price: { type: "number", default: 0 }, cover: { type: "image", default: { _type: "img", src: "", alt: "" } }, active: { type: "boolean", default: false }, released: { type: "date", default: "2026-01-01" }, body: { type: "richtext", default: [] }, intro: { type: "text", default: [] } };
  const s = read.schema({ source: file("schemas/product.json", JSON.stringify({ document: true, path: "/products", key: "slug", fields: typed, pull: { request: { url: "https://api.test/items" }, select: "response.body.items" } })) })!;
  const { fetch } = fake(() => ({ items: [{ slug: "a", title: 42, price: " 9.5 ", cover: "https://cdn.test/a.png", active: "1", released: 1767225600, body: "<p>a</p><p>b</p>", intro: "Hi" }, { slug: "b", body: "# Hi" }] }));

  const { pulled: [a, b] } = await pull({ schema: s, schemas: [s], sources: [], fetch });
  const data = fieldsOf(a);
  assert.equal(data.title, "42");
  assert.equal(data.price, 9.5);
  assert.deepEqual(data.cover, { _type: "img", src: "https://cdn.test/a.png", alt: "" });
  assert.equal(data.active, true);
  assert.equal(data.released, "2026-01-01", "unix seconds");
  assert.deepEqual(data.body, [{ _type: "p", children: [{ _type: "text", text: "a" }] }, { _type: "p", children: [{ _type: "text", text: "b" }] }], "html");
  assert.deepEqual(data.intro, [{ _type: "text", text: "Hi" }]);
  assert.deepEqual(fieldsOf(b).body, [{ _type: "h1", children: [{ _type: "text", text: "Hi" }] }], "markdown");
});

test("pull: a raw nested list gets its only allowed _type, coerced fields and no unknown keys, at any depth", async () => {
  const variant = read.schema({ source: file("schemas/variant.json", JSON.stringify({ fields: { sku: { type: "string", default: "" }, price: { type: "number", default: 0 }, options: { type: "fragments", allow: ["opt"], default: [] } } })) })!;
  const opt = read.schema({ source: file("schemas/opt.json", JSON.stringify({ fields: { name: { type: "string", default: "" } } })) })!;
  const two = read.schema({ source: file("schemas/two.json", JSON.stringify({ fields: { x: { type: "string", default: "" } } })) })!;
  const s = schema({ map: { slug: "slug", variants: "variants", any: "variants" } }, { fields: { ...fields, variants: { type: "fragments", allow: ["variant"], default: [] }, any: { type: "fragments", allow: ["variant", "two"], default: [] } } });
  const { fetch } = fake(() => ({ items: [{ slug: "a", variants: [{ id: 7, sku: 1, price: "9.5", options: [{ name: "red" }] }] }] }));

  const { pulled, failed } = await pull({ schema: s, schemas: [s, variant, opt, two], sources: [], fetch });
  assert.deepEqual(pulled, []);
  assert.match(failed[0].error, /^any\.0: Fragment type "undefined"/, "several allowed types stay ambiguous");

  const one = schema({ map: { slug: "slug", variants: "variants" } }, { fields: { ...fields, variants: { type: "fragments", allow: ["variant"], default: [] } } });
  const { pulled: [out] } = await pull({ schema: one, schemas: [one, variant, opt], sources: [], fetch });
  assert.deepEqual(fieldsOf(out).variants, [{ _type: "variant", sku: "1", price: 9.5, options: [{ _type: "opt", name: "red" }] }]);
});

test("pull: a value no rule fits still fails validation", async () => {
  const { fetch } = fake(() => ({ items: [{ slug: "a", price: "$12" }] }));
  const s = schema({});
  const { pulled, failed } = await pull({ schema: s, schemas: [s], sources: [], fetch });
  assert.deepEqual(pulled, []);
  assert.match(failed[0].error, /Expected number, got string/);
});

test("pull: an existing file is updated in place, keeping its other fields, comments and extension", async () => {
  const yml = identify(file("documents/products/a.yml", "# keep me\n_type: product\ntitle: Old\nprice: 3\n"));
  const json = identify(file("documents/products/.b.json", JSON.stringify({ _type: "product", slug: "b", title: "B", price: 2 })));
  const { fetch } = fake(() => ({ items: [{ slug: "a", title: "New" }, { slug: "b", title: "B" }] }));
  const s = schema({ map: { slug: "slug", title: "title" } });

  const { pulled: out } = await pull({ schema: s, schemas: [s], sources: [yml, json], fetch });
  assert.equal(out.length, 1, "the unchanged .b.json is left out");
  assert.equal(out[0].path, "/documents/products/a.yml");
  assert.match(out[0].data!, /^# keep me\n/);
  assert.equal(fieldsOf(out[0]).title, "New");
  assert.equal(fieldsOf(out[0]).price, 3);
  assert.equal(fieldsOf(out[0])._id, fieldsOf(yml)._id);
});

test("pull: a dot key sets only that path, keeping the rest of the object in an existing or new file", async () => {
  const yml = identify(file("documents/products/a.yml", "_type: product\ncover:\n  _type: img\n  src: old.png\n  alt: Kept alt\n"));
  const { fetch } = fake(() => ({ items: [{ slug: "a", image: "new.png" }, { slug: "b", image: "b.png" }] }));
  const s = schema({ map: { slug: "slug", "cover.src": "image" } });

  const { pulled: [a, b] } = await pull({ schema: s, schemas: [s], sources: [yml], fetch });
  assert.deepEqual(fieldsOf(a).cover, { _type: "img", src: "new.png", alt: "Kept alt" });
  assert.deepEqual(fieldsOf(b).cover, { _type: "img", src: "b.png", alt: "" }, "a new file keeps the default's other keys");
});

test("pull: null deletes the field from an existing file, a new file keeps the default", async () => {
  const yml = identify(file("documents/products/a.yml", "_type: product\ntitle: Old\nprice: 3\n"));
  const { fetch } = fake(() => ({ items: [{ slug: "a", title: null }, { slug: "b", title: null }] }));
  const s = schema({ map: { slug: "slug", title: "title" } });

  const { pulled: [a, b] } = await pull({ schema: s, schemas: [s], sources: [yml], fetch });
  assert.equal("title" in fieldsOf(a), false);
  assert.equal(fieldsOf(a).price, 3);
  assert.equal(fieldsOf(b).title, "");
});

test("pull: a changed hidden .json file stays hidden JSON", async () => {
  const json = identify(file("documents/products/.a.json", JSON.stringify({ _type: "product", slug: "a", title: "Old", price: 3 })));
  const { fetch } = fake(() => ({ items: [{ slug: "a", title: "New" }] }));
  const s = schema({ map: { slug: "slug", title: "title" } });

  const { pulled: [out] } = await pull({ schema: s, schemas: [s], sources: [json], fetch });
  assert.equal(out.path, "/documents/products/.a.json");
  assert.deepEqual(JSON.parse(out.data!), { ...JSON.parse(json.data!), title: "New" });
});

test("pull: the key is stored in the key field, and a renamed or moved document is still found by it", async () => {
  const { fetch } = fake(() => ({ items: [{ slug: "a", title: "A" }] }));
  const s = schema({ map: { slug: "slug", title: "title" } });

  const { pulled: [created] } = await pull({ schema: s, schemas: [s], sources: [], fetch });
  assert.equal(fieldsOf(created).slug, "a");

  const moved = identify(file("documents/elsewhere/my-shirt.yml", "_type: product\nslug: a\ntitle: Old\n"));
  const { pulled: [updated] } = await pull({ schema: s, schemas: [s], sources: [moved], fetch });
  assert.equal(updated.path, "/documents/elsewhere/my-shirt.yml");
  assert.equal(fieldsOf(updated).title, "A");
});

test("pull: a file without a key yet is found at its path and gets one", async () => {
  const legacy = identify(file("documents/products/a.yml", "_type: product\ntitle: A\n"));
  const { fetch } = fake(() => ({ items: [{ slug: "a", title: "A" }] }));
  const s = schema({ map: { slug: "slug", title: "title" } });

  const { pulled: [out] } = await pull({ schema: s, schemas: [s], sources: [legacy], fetch });
  assert.equal(out.path, "/documents/products/a.yml");
  assert.equal(fieldsOf(out).slug, "a");
});

test("pull: pulled documents whose key is gone are pruned, unless the pull is empty or prune is false", async () => {
  const kept = identify(file("documents/products/a.yml", "_type: product\nslug: a\ntitle: A\n"));
  const gone = identify(file("documents/products/b.yml", "_type: product\nslug: b\n"));
  const manual = identify(file("documents/products/c.yml", "_type: product\ntitle: C\n"));
  const sources = [kept, gone, manual];
  const { fetch } = fake(() => ({ items: [{ slug: "a", title: "A" }] }));
  const s = schema({ map: { slug: "slug", title: "title" } });

  assert.deepEqual((await pull({ schema: s, schemas: [s], sources, fetch })).pruned, [gone]);
  assert.deepEqual((await pull({ schema: s, schemas: [s], sources, fetch: fake(() => ({ items: [] })).fetch })).pruned, []);
  const off = schema({ map: { slug: "slug", title: "title" }, prune: false });
  assert.deepEqual((await pull({ schema: off, schemas: [off], sources, fetch })).pruned, []);
});

test("pull: a document joins the scope, so the request can target it, and its key fills a dropped query param", async () => {
  const { fetch, calls } = fake(() => ({ items: [{ slug: "a", title: "New" }] }));
  const s = schema({ request: { url: "https://api.test/items?slug={{slug}}" }, map: { slug: "slug", title: "title" } });
  const a = identify(file("documents/products/a.yml", "_type: product\nslug: a\ntitle: Old\n"));
  await pull({ schema: s, schemas: [s], sources: [a], fetch });
  await pull({ schema: s, schemas: [s], sources: [a], document: a, fetch });
  assert.deepEqual(calls.map((c) => c.url.search), ["", "?slug=a"]);
});

test("pull: with a document only its item is written, and nothing is pruned", async () => {
  const a = identify(file("documents/products/a.yml", "_type: product\nslug: a\ntitle: Old\n"));
  const b = identify(file("documents/products/b.yml", "_type: product\nslug: b\ntitle: B\n"));
  const { fetch } = fake(() => ({ items: [{ slug: "a", title: "New" }, { slug: "c", title: "C" }] }));
  const s = schema({ map: { slug: "slug", title: "title" } });
  const { pulled, pruned } = await pull({ schema: s, schemas: [s], sources: [a, b], document: a, fetch });
  assert.deepEqual(pulled.map((u) => [u.path, fieldsOf(u).title]), [["/documents/products/a.yml", "New"]]);
  assert.deepEqual(pruned, []);
});

test("pull: a document of another schema, without a key, or missing from the response, is an error", async () => {
  const { fetch, calls } = fake(() => ({ items: [{ slug: "b" }] }));
  const s = schema({});
  const manual = identify(file("documents/products/manual.yml", "_type: product\ntitle: Manual\n"));
  const a = identify(file("documents/products/a.yml", "_type: product\nslug: a\n"));
  const post = identify(file("documents/post.yml", "_type: post\n"));
  await assert.rejects(pull({ schema: s, schemas: [s], sources: [post], document: post, fetch }), /isn't a "product" document/);
  await assert.rejects(pull({ schema: s, schemas: [s], sources: [manual], document: manual, fetch }), /has no slug/);
  assert.equal(calls.length, 0);
  await assert.rejects(pull({ schema: s, schemas: [s], sources: [a], document: a, fetch }), /slug "a" isn't in the response/);
});

test("pull: a path holding another key, or a key held by two documents, fails that item", async () => {
  const renamed = identify(file("documents/products/a.yml", "_type: product\nslug: b\n"));
  const twice = [identify(file("documents/x.yml", "_type: product\nslug: c\n")), identify(file("documents/y.yml", "_type: product\nslug: c\n"))];
  const { fetch } = fake(() => ({ items: [{ slug: "a" }, { slug: "c" }] }));
  const s = schema({});

  const { failed } = await pull({ schema: s, schemas: [s], sources: [renamed, ...twice], fetch });
  assert.deepEqual(failed.map((f) => f.path), ["/documents/products/a", "/documents/products/c"]);
  assert.match(failed[0].error, /a\.yml is taken by key "b"/);
  assert.match(failed[1].error, /matches more than one file/);
});

test("pull: documents the API no longer returns are left alone", async () => {
  const yml = identify(file("documents/products/gone.yml", "_type: product\ntitle: Gone\n"));
  const { fetch } = fake(() => ({ items: [{ slug: "a" }] }));
  const s = schema({});

  const { pulled: out } = await pull({ schema: s, schemas: [s], sources: [yml], fetch });
  assert.deepEqual(out.map((o) => o.path), ["/documents/products/a.yml"]);
});

test("pull: a singleton takes one object, and updates its document wherever it lives", async () => {
  const { fetch } = fake(() => ({ data: { shop: { name: "Store" } } }));
  const s = schema({ select: "response.body.data.shop", map: { title: "name" } }, { singleton: true, path: "/settings", key: undefined });

  const { pulled: [created] } = await pull({ schema: s, schemas: [s], sources: [], fetch });
  assert.equal(created.path, "/documents/settings.yml");
  assert.equal(fieldsOf(created).title, "Store");

  const moved = identify(file("documents/elsewhere.yml", "_type: product\ntitle: Old\n"));
  const { pulled: [updated] } = await pull({ schema: s, schemas: [s], sources: [moved], fetch });
  assert.equal(updated.path, "/documents/elsewhere.yml");
  assert.equal(fieldsOf(updated).title, "Store");

  const many = fake(() => ({ data: { shop: [{ name: "A" }, { name: "B" }] } }));
  await assert.rejects(pull({ schema: s, schemas: [s], sources: [], fetch: many.fetch }), /received 2 items/);
});

test("pull: 429 and 5xx are retried, honoring Retry-After", async () => {
  const { fetch, calls } = fake((_, __, n) => (n < 2 ? new Response("slow down", { status: n === 0 ? 429 : 503, headers: { "retry-after": "0" } }) : { items: [{ slug: "a" }] }));
  const s = schema({});

  const { pulled: out } = await pull({ schema: s, schemas: [s], sources: [], fetch });
  assert.equal(calls.length, 3);
  assert.equal(out.length, 1);
});

test("pull: a failed request throws without the url's query, so keys don't leak", async () => {
  const { fetch } = fake(() => new Response("nope", { status: 401 }));
  const s = schema({ request: { url: "https://api.test/items?access_token={{key}}" }, init: { key: "'secret'" } });

  await assert.rejects(pull({ schema: s, schemas: [s], sources: [], fetch }), (e: Error) => /GET https:\/\/api\.test\/items responded 401/.test(e.message) && !e.message.includes("secret"));
  const html = fake(() => new Response("<html>", { status: 200 }));
  await assert.rejects(pull({ schema: s, schemas: [s], sources: [], fetch: html.fetch }), /didn't return JSON/);
});

test("pull: an invalid spec throws before any request", async () => {
  const { fetch, calls } = fake(() => ({ items: [] }));
  const cases: [Schema, RegExp][] = [
    [schema({ next: { offset: "offset +" } }), /Invalid expression in pull\.next\.offset/],
    [schema({ request: { url: "https://api.test/{{ ) }}" } }), /Invalid expression in pull\.request/],
    [schema({ map: { slug: "slug", nope: "title" } }), /pull\.map\.nope isn't a field/],
    [schema({ map: { slug: "slug", constructor: "title" } }), /isn't a field/],
    [schema({}, { key: undefined }), /needs a key/],
    [schema({ map: { title: "title" } }), /pull\.map must set the key "slug"/],
    [schema({}, { document: false, key: undefined }), /must be a document/],
  ];
  for (const [s, error] of cases) await assert.rejects(pull({ schema: s, schemas: [s], sources: [], fetch }), error);
  assert.equal(calls.length, 0);
});

test("pull: select finding nothing on the first page is an error, an empty list is not", async () => {
  const s = schema({});
  await assert.rejects(pull({ schema: s, schemas: [s], sources: [], fetch: fake(() => ({ data: [] })).fetch }), /found nothing/);
  assert.deepEqual(await pull({ schema: s, schemas: [s], sources: [], fetch: fake(() => ({ items: [] })).fetch }), { pulled: [], pruned: [], failed: [] });
});

test("pull: without select the response body holds the items", async () => {
  const s = schema({ select: undefined });
  const { pulled } = await pull({ schema: s, schemas: [s], sources: [], fetch: fake(() => [{ slug: "a", title: "A" }]).fetch });
  assert.deepEqual(pulled.map((c) => c.path), ["/documents/products/a.yml"]);
});

test("pull: bad items are skipped and returned in failed, the good ones are still pulled, and a failed key isn't pruned", async () => {
  const other = identify(file("documents/products/taken.yml", "_type: post\n"));
  const twice = [identify(file("documents/x.yml", "_type: product\nslug: kept\n")), identify(file("documents/y.yml", "_type: product\nslug: kept\n"))];
  const { fetch } = fake(() => ({ items: [{ slug: "a/b" }, { slug: "x" }, { slug: "x" }, { slug: "" }, { title: "no key" }, "text", { slug: "taken" }, { slug: "ok", price: "NaN" }, { slug: "good" }, { slug: "kept" }] }));
  const s = schema({});

  const { pulled, pruned, failed } = await pull({ schema: s, schemas: [s], sources: [other, ...twice], fetch });
  assert.deepEqual(pulled.map((p) => p.path), ["/documents/products/x.yml", "/documents/products/good.yml"]);
  assert.deepEqual(pruned, []);
  assert.deepEqual(failed.map((f) => f.path), ["#0", "/documents/products/x", "#3", "#4", "#5", "/documents/products/taken", "/documents/products/ok", "/documents/products/kept"]);
  const errors = failed.map((f) => f.error).join("\n");
  for (const message of [/contains "\/"/, /same key as an earlier item/, /empty string/, /resolved to nothing/, /isn't an object/, /is a "post" file, not "product"/, /matches more than one file/]) assert.match(errors, message);
});

test("pull: a next that never stops is cut off", async () => {
  const { fetch } = fake((url) => ({ items: [{ slug: `p${url.searchParams.get("page")}` }] }));
  const s = schema({ request: { url: "https://api.test/items?page={{page}}" }, init: { page: "1" }, next: { page: "page + 1" } });
  await assert.rejects(pull({ schema: s, schemas: [s], sources: [], fetch }), /Stopped after 100 pages/);
});

test("pull: a next that doesn't change the scope stops, but not when the page repeats too", async () => {
  const { fetch, calls } = fake((_, __, n) => ({ items: [{ slug: `s${n}` }], cursor: "same" }));
  const s = schema({ request: { url: "https://api.test/items?c={{c}}" }, next: { c: "response.body.cursor" } });
  const { pulled, failed } = await pull({ schema: s, schemas: [s], sources: [], fetch });
  assert.deepEqual(failed, []);
  assert.equal(pulled.length, 2);
  assert.equal(calls.length, 2);

  /* The same items under a constant cursor: the API ignores it, and pruning page 1 alone would delete the rest */
  await assert.rejects(pull({ schema: s, schemas: [s], sources: [], fetch: fake(() => ({ items: [{ slug: "a" }], cursor: "same" })).fetch }), /Page 2 returned the same items as page 1/);
});


test("pull: a next that loops back to an earlier request is an error", async () => {
  /* page 1 -> 2 -> 1: each step changes the scope, so only remembering every request catches it */
  const { fetch, calls } = fake((url) => ({ items: [{ slug: `p${url.searchParams.get("page")}-${Math.random()}` }] }));
  const s = schema({ request: { url: "https://api.test/items?page={{page}}" }, init: { page: "1" }, next: { page: "page === 1 ? 2 : 1" } });
  await assert.rejects(pull({ schema: s, schemas: [s], sources: [], fetch }), /pull\.next loops: page 3 repeats the request of page 1/);
  assert.equal(calls.length, 2);
});

test("pull: an API that ignores next and repeats its page is an error", async () => {
  const { fetch, calls } = fake(() => ({ items: [{ slug: "a" }, { slug: "b" }] }));
  const s = schema({ request: { url: "https://api.test/items?page={{page}}" }, init: { page: "1" }, next: { page: "page + 1" } });
  await assert.rejects(pull({ schema: s, schemas: [s], sources: [], fetch }), /Page 2 returned the same items as page 1/);
  assert.equal(calls.length, 2);
});

test("pull: the pages and items limits stop a large pull", async () => {
  const { fetch } = fake((url) => ({ items: [{ slug: `a${url.searchParams.get("page")}` }, { slug: `b${url.searchParams.get("page")}` }] }));
  const s = schema({ request: { url: "https://api.test/items?page={{page}}" }, init: { page: "1" }, next: { page: "page + 1" } });
  await assert.rejects(pull({ schema: s, schemas: [s], sources: [], fetch, limits: { pages: 3 } }), /Stopped after 3 pages/);
  await assert.rejects(pull({ schema: s, schemas: [s], sources: [], fetch, limits: { items: 5 } }), /Stopped after 5 items/);
});

test("pull: the deadline aborts a hanging request and a long Retry-After wait", async () => {
  const s = schema({});
  const hang = async (_: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)));
  await assert.rejects(pull({ schema: s, schemas: [s], sources: [], fetch: hang, limits: { seconds: 0.05 } }), /Stopped after 0\.05s/);

  const { fetch, calls } = fake(() => new Response("busy", { status: 503, headers: { "retry-after": "60" } }));
  const start = Date.now();
  await assert.rejects(pull({ schema: s, schemas: [s], sources: [], fetch, limits: { seconds: 0.05 } }), /Stopped after 0\.05s/);
  assert.ok(Date.now() - start < 1000);
  assert.equal(calls.length, 1);
});

test("pull: a response over the size limit is cut off, by its Content-Length or while streaming", async () => {
  const s = schema({});
  const big = JSON.stringify({ items: [{ slug: "a", title: "x".repeat(2000) }] });
  await assert.rejects(pull({ schema: s, schemas: [s], sources: [], fetch: fake(() => new Response(big)).fetch, limits: { bytes: 1024 } }), /responded with more than 1 KB/);

  const stream = new ReadableStream({ pull: (c) => c.enqueue(new TextEncoder().encode("x".repeat(512))) });
  await assert.rejects(pull({ schema: s, schemas: [s], sources: [], fetch: fake(() => new Response(stream)).fetch, limits: { bytes: 4096 } }), /more than 4 KB/);
});

test("pull: a next that grows the request every page is stopped before it is sent", async () => {
  const { fetch, calls } = fake((_, __, n) => ({ items: [{ slug: `s${n}` }] }));
  const s = schema({ request: { url: "https://api.test/items?c={{c}}" }, init: { c: "'ab'" }, next: { c: "c + c" } });
  await assert.rejects(pull({ schema: s, schemas: [s], sources: [], fetch }), /has a url over 2 KB/);
  assert.ok(calls.length < 15);

  const body = schema({ request: { url: "https://api.test/items", body: { c: "{{c}}" } }, init: { c: "'ab'" }, next: { c: "c + c" } });
  await assert.rejects(pull({ schema: body, schemas: [body], sources: [], fetch, limits: { body: 1024 } }), /has a body over 1 KB/);
});
