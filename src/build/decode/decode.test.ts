import { test } from "node:test";
import assert from "node:assert/strict";
import { decode, entry } from "./index.js";
import { source } from "../source/index.js";

const file = (path: string, data: string | null) => source({ path, data });

test("decode: picks the parser from the extension and merges the data onto the `_` fields", () => {
  assert.equal(decode({ source: file("a.json", '{ "title": "Hi" }') }).title, "Hi");
  assert.equal(decode({ source: file("a.yml", "title: Hi\n") }).title, "Hi");
  assert.equal(decode({ source: file("a.yaml", "title: Hi\n") }).title, "Hi");
  const md = decode({ source: file("a.md", "---\ntitle: Hi\n---\n# Heading\n") });
  assert.equal(md.title, "Hi");
  assert.deepEqual(md.children, [{ _type: "h1", children: [{ _type: "text", text: "Heading" }] }]);
  assert.deepEqual(decode({ source: file("a.html", "<p>Hi</p>") }).children, [{ _type: "p", children: [{ _type: "text", text: "Hi" }] }]);
});

test("decode: an unknown extension or a binary file is just its `_` fields", () => {
  const css = file("a.css", "a{}");
  assert.deepEqual(decode({ source: css }), entry(css));
  const png = file("a.png", null);
  assert.deepEqual(decode({ source: png }), entry(png));
});

test("decode: `_` keys from the file are kept, but the source's own `_` fields win, with a warning each", () => {
  const s = file("a.json", '{ "_type": "post", "_path": "/evil", "_size": 1, "title": "Hi" }');
  const warnings: string[] = [];
  const decoded = decode({ source: s, warnings });
  assert.equal(decoded._type, "post");
  assert.equal(decoded._path, "/a.json");
  assert.equal(decoded._size, s.size);
  assert.deepEqual(warnings, ["_path: can't be set in the file, ignored", "_size: can't be set in the file, ignored"]);
});

test("decode: a file that doesn't parse is just its `_` fields", () => {
  const s = file("a.json", "{ not json");
  assert.deepEqual(decode({ source: s, errors: [] }), entry(s));
});

test("decode: a JSON or YAML file that isn't an object (e.g. a list) is just its `_` fields", () => {
  for (const s of [file("a.json", "[1, 2]"), file("a.yml", "- 1\n- 2\n"), file("b.json", '"text"')]) assert.deepEqual(decode({ source: s }), entry(s));
});

test("decode: an extension named like an Object.prototype member (\"constructor\") is just its `_` fields", () => {
  const s = file("a.constructor", "hi");
  assert.deepEqual(decode({ source: s }), entry(s));
});
