import { test } from "node:test";
import assert from "node:assert/strict";
import { lint } from "./index.js";
import { source } from "../source/index.js";

const post = source({ path: "schemas/post.json", data: JSON.stringify({ document: true, fields: { title: { type: "string", default: "" }, n: { type: "number", default: 0, max: 5 } } }) });

test("lint: one result per file, in order, with every problem collected instead of thrown", () => {
  const results = lint({ sources: [
    post,
    source({ path: "documents/a.yml", data: "_type: post\n_id: a\ntitle: 3\nn: 9\n" }),
    source({ path: "documents/b.yml", data: "_type: post\n" }),
    source({ path: "components/x.css", data: "a{}" }),
  ] });
  assert.deepEqual(results.map((r) => r.path), ["/schemas/post.json", "/documents/a.yml", "/documents/b.yml", "/components/x.css"]);
  assert.deepEqual(results[0].errors, []);
  assert.deepEqual(results[1].errors, ["title: Expected string, got number", "n: Number 9 exceeds maximum 5"]);
  assert.deepEqual(results[2].errors, ["_id: missing in /b.yml"]);
  assert.match(results[3].errors[0], /only takes .html files/);
});

test("lint: an asset comes back clean unless its extension isn't an asset's, a file outside the folders always does", () => {
  const results = lint({ sources: [source({ path: "assets/logo.png", data: null }), source({ path: "assets/tool.exe", data: null, size: 1 }), source({ path: "notes.txt", data: "x" })] });
  assert.deepEqual(results.map((r) => r.errors.length), [0, 1, 0]);
  assert.match(results[1].errors[0], /^\/assets\/ only takes /);
});

test("lint: an asset at a document's output path is a warning on the asset", () => {
  const home = source({ path: "documents/index.json", data: '{ "_type": "post", "_id": "home" }' });
  const about = source({ path: "documents/about.yml", data: "_type: post\n_id: about\n" });
  const a = source({ path: "assets/index.html", data: "<p>Hi</p>" });
  const b = source({ path: "assets/about/index.html", data: "<p>Hi</p>" });
  const c = source({ path: "assets/about.html", data: "<p>Hi</p>" });
  const results = lint({ sources: [post, home, about, a, b, c], paths: [a.path, b.path, c.path] });
  assert.deepEqual(results.map((r) => r.warnings), [["Replaces the page of /documents/index.json"], ["Replaces the page of /documents/about.yml"], []]);
});

test("lint: uses the schemas among `sources` when only some `paths` are linted", () => {
  const doc = source({ path: "documents/a.yml", data: "_type: post\n_id: a\ntitle: Hi\n" });
  assert.deepEqual(lint({ sources: [post, doc], paths: [doc.path] })[0].errors, []);
  assert.deepEqual(lint({ sources: [doc] })[0].errors, ['No schema found for document type "post"']);
});

const product = source({ path: "schemas/product.json", data: JSON.stringify({ document: true, key: "handle", fields: { handle: { type: "string", nullable: true, immutable: true, default: null } } }) });

test("lint: a key held by two documents of a type is a warning on both, an empty key is no key", () => {
  const a = source({ path: "documents/a.yml", data: "_type: product\n_id: a\nhandle: shirt\n" });
  const b = source({ path: "documents/b.yml", data: "_type: product\n_id: b\nhandle: shirt\n" });
  const c = source({ path: "documents/c.yml", data: "_type: product\n_id: c\nhandle: hat\n" });
  const empty = [source({ path: "documents/d.yml", data: "_type: product\n_id: d\nhandle: null\n" }), source({ path: "documents/e.yml", data: "_type: product\n_id: e\nhandle: \"\"\n" }), source({ path: "documents/f.yml", data: "_type: product\n_id: f\n" })];
  const results = lint({ sources: [product, a, b, c, ...empty] });
  assert.deepEqual(results[1].warnings, ['handle "shirt" is also used by /documents/b.yml']);
  assert.deepEqual(results[2].warnings, ['handle "shirt" is also used by /documents/a.yml']);
  assert.deepEqual(results.slice(1).map((r) => r.errors), [[], [], [], [], [], []]);
  assert.deepEqual(results.slice(3).map((r) => r.warnings), [[], [], [], []]);
});

test("lint: `sources` finds a key held outside the linted files", () => {
  const a = source({ path: "documents/a.yml", data: "_type: product\n_id: a\nhandle: shirt\n" });
  const b = source({ path: "documents/b.yml", data: "_type: product\n_id: b\nhandle: shirt\n" });
  const [result] = lint({ sources: [product, a, b], paths: [a.path] });
  assert.deepEqual(result.warnings, ['handle "shirt" is also used by /documents/b.yml']);
});

test("lint: a singleton type with two documents is a warning on both", () => {
  const settings = source({ path: "schemas/settings.json", data: JSON.stringify({ document: true, singleton: true, fields: { title: { type: "string", default: "" } } }) });
  const a = source({ path: "documents/settings.yml", data: "_type: settings\n_id: a\n" });
  const b = source({ path: "documents/settings/1.yml", data: "_type: settings\n_id: b\n" });
  const results = lint({ sources: [settings, a, b], paths: [a.path, b.path] });
  assert.deepEqual(results.map((r) => r.warnings), [['Singleton "settings" is also used by /documents/settings/1.yml'], ['Singleton "settings" is also used by /documents/settings.yml']]);
  assert.deepEqual(lint({ sources: [settings, a], paths: [a.path] })[0].warnings, []);
});

test("lint: an _id held by two files is a warning on both", () => {
  const a = source({ path: "documents/a.yml", data: "_type: post\n_id: same\n" });
  const b = source({ path: "documents/b.yml", data: "_type: post\n_id: same\n" });
  const results = lint({ sources: [post, a, b], paths: [a.path, b.path] });
  assert.deepEqual(results.map((r) => r.warnings), [['_id "same" is also used by /documents/b.yml'], ['_id "same" is also used by /documents/a.yml']]);
});

test("lint: a reference to an _id no file has is a warning, once, and one in a key the schema doesn't define isn't counted", () => {
  const page = source({ path: "schemas/page.json", data: JSON.stringify({ document: true, fields: { related: { type: "references", allow: [], default: [] } } }) });
  const a = source({ path: "documents/a.yml", data: "_type: page\n_id: a\nrelated:\n  - _ref: b\n  - _ref: gone\n  - _ref: gone\nold:\n  _ref: also-gone\n" });
  const b = source({ path: "documents/b.yml", data: "_type: page\n_id: b\n" });
  const [result] = lint({ sources: [page, a, b], paths: [a.path] });
  assert.deepEqual(result.warnings, ["old: Not in the schema, so it's ignored", 'Reference "gone" doesn\'t exist']);
});

test("lint: a document whose schema isn't a document schema is a warning", () => {
  const hero = source({ path: "schemas/Hero.json", data: JSON.stringify({ fields: { heading: { type: "string", default: "" } } }) });
  const a = source({ path: "documents/a.yml", data: "_type: Hero\n_id: a\n" });
  const [result] = lint({ sources: [hero, a], paths: [a.path] });
  assert.deepEqual(result.warnings, ['"Hero" isn\'t a document schema (document: true), so it shouldn\'t live in /documents/']);
});

test("lint: two documents serving the same route is an error on both, whatever their extension or index", () => {
  const a = source({ path: "documents/about.yml", data: "_type: post\n_id: a\n" });
  const b = source({ path: "documents/about/index.md", data: "---\n_type: post\n_id: b\n---\n" });
  const c = source({ path: "documents/index.yml", data: "_type: post\n_id: c\n" });
  const results = lint({ sources: [post, a, b, c], paths: [a.path, b.path, c.path] });
  assert.deepEqual(results.map((r) => r.errors), [['Route "/about" is also used by /documents/about/index.md'], ['Route "/about" is also used by /documents/about.yml'], []]);
});
