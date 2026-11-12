import { test } from "node:test";
import assert from "node:assert/strict";
import { encode } from "./index.js";
import { decode, entry } from "../decode/index.js";
import { source } from "../source/index.js";

const fields = (path: string, data: Record<string, unknown>) => ({ ...entry(source({ path, data: "" })), ...data });

test("encode: the reverse of decode for every structured format", () => {
  for (const path of ["a.json", "a.yml", "a.md"]) {
    const out = encode({ entry: fields(path, { title: "Hi", count: 2 }) });
    const back = decode({ source: out });
    assert.equal(back.title, "Hi", path);
    assert.equal(back.count, 2, path);
  }
});

test("encode: returns a plain Source, the data's fields only live in `data`", () => {
  const out = encode({ entry: fields("a.json", { title: "Hi" }) }) as Record<string, unknown>;
  assert.equal(out.path, "/a.json");
  assert.equal(out.title, undefined);
  assert.equal(out.size, new TextEncoder().encode(out.data as string).length);
});

test("encode: the source's own `_` fields are left out, other `_` keys are written", () => {
  const e = fields("a.json", { _type: "post", _id: "a", title: "Hi" });
  assert.deepEqual(JSON.parse(encode({ entry: e }).data!), { _type: "post", _id: "a", title: "Hi" });
});

test("encode: an unknown extension keeps its data as is", () => {
  const e = { ...entry(source({ path: "a.css", data: "a{}" })), title: "ignored" };
  assert.equal(encode({ entry: e }).data, "a{}");
});

test("encode: an extension named like an Object.prototype member (\"constructor\") keeps its `_data`", () => {
  const s = source({ path: "a.constructor", data: "hi" });
  assert.equal(encode({ entry: decode({ source: s }) }).data, "hi");
});
