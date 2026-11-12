import { test } from "node:test";
import assert from "node:assert/strict";
import * as sanitize from "./index.js";
import { entry } from "../decode/index.js";
import { source } from "../source/index.js";

const meta = (path: string, data = "") => entry(source({ path, data }));

test("sanitize.document: keeps the document's own fields next to its `_` fields", () => {
  const doc = sanitize.document({ entry: { ...meta("/a.yml"), _id: "a", _type: "post", title: "Hi" } })!;
  assert.equal(doc._id, "a");
  assert.equal(doc.title, "Hi");
});

test("sanitize.document: `_type` and `_id` are required, an error without them (thrown without `errors`)", () => {
  assert.throws(() => sanitize.document({ entry: { ...meta("/a.yml"), _id: "a" } }), /_type: missing/);
  assert.throws(() => sanitize.document({ entry: { ...meta("/a.yml"), _type: "post" } }), /_id: missing/);
  const errors: string[] = [];
  assert.equal(sanitize.document({ entry: { ...meta("/a.yml"), _type: "post", _id: "" }, errors }), null);
  assert.deepEqual(errors, ["_id: missing in /a.yml"]);
});

test("sanitize.document: `_slug` is derived from the path, any other `_` key in the file is ignored with a warning", () => {
  const warnings: string[] = [];
  const doc = sanitize.document({ entry: { ...meta("/blog/index.yml"), _type: "post", _id: "a", _slug: "/elsewhere", _foo: 1 }, warnings })!;
  assert.equal(doc._slug, "/blog");
  assert.equal(doc._foo, undefined);
  assert.deepEqual(warnings, ["_slug: can't be set in the file, ignored", "_foo: can't be set in the file, ignored"]);
});

test("sanitize.schema: `_type` is derived from the file name, a `_` key in the file is ignored with a warning", () => {
  const warnings: string[] = [];
  const schema = sanitize.schema({ entry: { ...meta("/Faq.json"), _type: "Question", fields: {} }, warnings })!;
  assert.equal(schema._type, "Faq");
  assert.deepEqual(warnings, ["_type: can't be set in the file, ignored"]);
});

test("sanitize.schema: an invalid shape is an error", () => {
  const errors: string[] = [];
  assert.equal(sanitize.schema({ entry: { ...meta("/Faq.json"), fields: "nope" }, errors }), null);
  assert.equal(errors.length, 1);
});

test("sanitize.component: `_type` is the file name's last segment", () => {
  assert.equal(sanitize.component({ entry: meta("/Product.Faq.html", "<p></p>") })!._type, "Faq");
});

test("sanitize.asset: passes an asset's `_` fields through", () => {
  assert.equal(sanitize.asset({ entry: meta("/logo.svg", "<svg/>") })!._data, "<svg/>");
});
