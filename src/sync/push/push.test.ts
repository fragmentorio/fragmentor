import { test } from "node:test";
import assert from "node:assert/strict";
import { source, read } from "../../build/source/index.js";
import { push } from "./index.js";
import type { Schema, Source, Push } from "../../model/types/index.js";

const file = (path: string, data: string) => source({ path, data });
const fields = { email: { type: "string", default: "" }, name: { type: "string", default: "" }, id: { type: "string", default: "" }, order: { type: "number", default: 0 }, lines: { type: "fragments", allow: ["line"], default: [] } };
const line = read.schema({ source: file("schemas/line.json", JSON.stringify({ fields: { sku: { type: "string", default: "" }, qty: { type: "number", default: 0 } } })) })!;
const schema = (spec: Partial<Push>): Schema =>
  read.schema({ source: file("schemas/contact.json", JSON.stringify({ document: true, fields, push: { request: { url: "https://api.test/contacts" }, ...spec } })) })!;

/* A document of `contact` (or `_type`) with these values */
let n = 0;
const contact = (values: Record<string, unknown>, _type = "contact") => file(`documents/contact/${++n}.json`, JSON.stringify({ _type, _id: `s${n}`, ...values }));

/* A fake fetch answering each request with `respond`, recording every request it got */
function fake(respond: (url: URL, init: RequestInit, n: number) => Response | unknown = () => ({})) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url: new URL(url), init });
    const res = respond(new URL(url), init, calls.length - 1);
    return res instanceof Response ? res : new Response(JSON.stringify(res));
  };
  return { fetch, calls };
}

/* Pushes one document, with `sources` around it */
const one = (s: Schema, document: Source, fetch: ReturnType<typeof fake>["fetch"], sources: Source[] = []) => push({ schema: s, schemas: [s, line], sources: [document, ...sources], document, fetch });

const bodyOf = (init: RequestInit) => JSON.parse(init.body as string);

test("push: without map the document's fields are POSTed as JSON, not its system values", async () => {
  const { fetch, calls } = fake();
  const s = schema({});
  const document = contact({ email: "a@b.c", name: "A" });
  assert.deepEqual(await one(s, document, fetch), { pushed: [document], failed: [] });
  assert.equal(calls[0].init.method, "POST");
  assert.equal((calls[0].init.headers as Record<string, string>)["content-type"], "application/json");
  assert.deepEqual(bodyOf(calls[0].init), { email: "a@b.c", name: "A", id: "", order: 0, lines: [] });
});

test("push: map builds the body, dot keys nest, constants are expressions, undefined is left out", async () => {
  const { fetch, calls } = fake();
  const s = schema({ map: { email_address: "email", "merge_fields.FNAME": "name", status: "'subscribed'", missing: "nope" } });
  await one(s, contact({ email: "a@b.c", name: "A" }), fetch);
  assert.deepEqual(bodyOf(calls[0].init), { email_address: "a@b.c", merge_fields: { FNAME: "A" }, status: "subscribed" });
});

test("push: a request.body template overrides map", async () => {
  const { fetch, calls } = fake();
  const s = schema({ request: { url: "https://api.test/contacts", body: { text: "New: {{email}}", source: "site" } }, map: { email: "email" } });
  await one(s, contact({ email: "a@b.c" }), fetch);
  assert.deepEqual(bodyOf(calls[0].init), { text: "New: a@b.c", source: "site" });
});

test("push: document values are never read as placeholders", async () => {
  const { fetch, calls } = fake();
  const s = schema({ map: { name: "name" } });
  await one(s, contact({ name: "{{secret}}" }), fetch);
  assert.deepEqual(bodyOf(calls[0].init), { name: "{{secret}}" });
});

test("push: context and the document fill the request, the method can be overridden", async () => {
  const ctx = read.schema({ source: file("schemas/settings.json", JSON.stringify({ document: true, singleton: true, fields: { token: { type: "string", default: "" }, list: { type: "string", default: "" } } })) })!;
  const settings = file("documents/settings.yml", "_type: settings\n_id: s1\ntoken: abc\nlist: l1\n");
  const { fetch, calls } = fake();
  const s = schema({ context: "settings", request: { method: "put", url: "https://api.test/lists/{{list}}/members/{{email}}", headers: { Authorization: "Bearer {{token}}" } } });
  const document = contact({ email: "a@b.c" });
  await push({ schema: s, schemas: [s, ctx, line], sources: [document, settings], document, fetch });
  assert.equal(calls[0].init.method, "PUT");
  assert.equal(calls[0].url.pathname, "/lists/l1/members/a%40b.c");
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, "Bearer abc");
});

test("push: select sends one request per item, each reading the item and the document", async () => {
  const { fetch, calls } = fake();
  const s = schema({ select: "lines", request: { url: "https://api.test/orders/{{order}}/lines" }, map: { sku: "sku", qty: "qty" } });
  await one(s, contact({ order: 7, lines: [{ _type: "line", sku: "a", qty: 1 }, { _type: "line", sku: "b", qty: 2 }] }), fetch);
  assert.deepEqual(calls.map((c) => [c.url.pathname, bodyOf(c.init)]), [["/orders/7/lines", { sku: "a", qty: 1 }], ["/orders/7/lines", { sku: "b", qty: 2 }]]);
});

test("push: select finding nothing sends nothing, and the document still counts as pushed", async () => {
  const { fetch, calls } = fake();
  const s = schema({ select: "lines" });
  const document = contact({});
  assert.deepEqual(await one(s, document, fetch), { pushed: [document], failed: [] });
  assert.equal(calls.length, 0);
});

test("push: next chains requests with the last response, a null value stops", async () => {
  const { fetch, calls } = fake((_, __, n) => ({ id: `c${n}` }));
  const s = schema({
    request: { url: "{{step == 1 ? 'https://api.test/contacts' : 'https://api.test/lists/members'}}" },
    init: { step: "1" },
    next: { step: "step < 2 ? step + 1 : null", contact: "response.body.id" },
    map: { email: "step == 1 ? email : undefined", contact: "contact" },
  });
  await one(s, contact({ email: "a@b.c" }), fetch);
  assert.deepEqual(calls.map((c) => [c.url.pathname, bodyOf(c.init)]), [["/contacts", { email: "a@b.c" }], ["/lists/members", { contact: "c0" }]]);
});

test("push: a next that loops back to an earlier request, or never ends, fails the document", async () => {
  const s = schema({ request: { url: "https://api.test/contacts/{{step}}" }, init: { step: "0" }, next: { step: "(step + 1) % 2", n: "response.body.n" } });
  const { failed } = await one(s, contact({ email: "a@b.c" }), fake((_, __, n) => ({ n })).fetch);
  assert.match(failed[0].error, /push\.next loops: request 3 repeats the request of request 1/);
  const endless = schema({ request: { url: "https://api.test/contacts/{{step}}" }, init: { step: "0" }, next: { step: "step + 1" } });
  const result = await push({ schema: endless, schemas: [endless, line], sources: [], document: contact({}), fetch: fake().fetch, limits: { pages: 3 } });
  assert.match(result.failed[0].error, /Stopped after 3 requests, push\.next may never end/);
});

test("push: a reply that isn't JSON is fine", async () => {
  const { fetch } = fake(() => new Response("ok"));
  const s = schema({});
  const document = contact({});
  assert.deepEqual(await one(s, document, fetch), { pushed: [document], failed: [] });
});

test("push: the method is a template", async () => {
  const { fetch, calls } = fake();
  const s = schema({ request: { method: "{{id ? 'PATCH' : 'POST'}}", url: "https://api.test/contacts/{{id ?? ''}}" } });
  await one(s, contact({ email: "a@b.c" }), fetch);
  await one(s, contact({ id: "c1", email: "a@b.c" }), fetch);
  assert.deepEqual(calls.map((c) => [c.init.method, c.url.pathname]), [["POST", "/contacts/"], ["PATCH", "/contacts/c1"]]);
});

test("push: without a document every document of the schema is pushed, and a failure doesn't stop the rest", async () => {
  const { fetch, calls } = fake((_, init) => (bodyOf(init).email === "bad" ? new Response("nope", { status: 400 }) : {}));
  const s = schema({ request: { url: "https://api.test/contacts?key=secret" } });
  const [a, bad, c, other] = [contact({ email: "a" }), contact({ email: "bad" }), contact({ email: "c" }), contact({ email: "x" }, "other")];
  const { pushed, failed } = await push({ schema: s, schemas: [s, line], sources: [a, bad, c, other], fetch });
  assert.deepEqual(pushed, [a, c]);
  assert.deepEqual(failed.map((f) => f.path), [bad.path]);
  /* The error names the request without its query, so keys don't leak */
  assert.match(failed[0].error, /POST https:\/\/api.test\/contacts responded 400/);
  assert.ok(!failed[0].error.includes("secret"));
  assert.equal(calls.length, 3);
});

test("push: an item that isn't an object fails its document", async () => {
  const { fetch } = fake();
  const s = schema({ select: "email" });
  const { failed } = await one(s, contact({ email: "a@b.c" }), fetch);
  assert.match(failed[0].error, /push.select item #0 isn't an object/);
});

test("push: an invalid spec, or a document of another schema, throws before any request", async () => {
  const { fetch, calls } = fake();
  for (const [spec, error] of [
    [{ map: { email: "email +" } }, /Invalid expression in push\.map\.email/],
    [{ next: { step: "step +" } }, /Invalid expression in push\.next\.step/],
    [{ request: { url: "https://api.test/{{ ) }}" } }, /Invalid expression in push\.request/],
  ] as [Partial<Push>, RegExp][]) {
    await assert.rejects(one(schema(spec), contact({}), fetch), error);
  }
  await assert.rejects(one(schema({}), file("documents/page.yml", "_type: page\n_id: p1\n"), fetch), /isn't a "contact" document/);
  assert.equal(calls.length, 0);
});
