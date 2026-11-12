import { test } from "node:test";
import assert from "node:assert/strict";
import { complete, resolve } from "./index.js";
import type { Document, Schema } from "../../model/types/index.js";

const doc = (_id: string, _type: string, data: Record<string, unknown> = {}) => ({ _id, _type, _path: `/${_id}.yml`, _extension: "yml", _hidden: false, _data: "", _size: 0, _raw: null, _created_at: "", _updated_at: "", ...data }) as Document;

test("resolve: replaces every `_ref` with its document, inside fragments too", () => {
  const author = doc("ada", "author", { name: "Ada" });
  const post = doc("p", "post", { author: { _ref: "ada" }, blocks: [{ _type: "quote", by: { _ref: "ada" } }] });
  const out = resolve({ document: post, references: [author, post] }) as Record<string, any>;
  assert.equal(out.author.name, "Ada");
  assert.equal(out.blocks[0].by.name, "Ada");
});

test("resolve: a dangling reference becomes null, and is dropped from an array", () => {
  const post = doc("p", "post", { author: { _ref: "gone" }, related: [{ _ref: "gone" }, { _ref: "p" }] });
  const out = resolve({ document: post, references: [post] }) as Record<string, any>;
  assert.equal(out.author, null);
  assert.equal(out.related.length, 1);
});

test("resolve: a loop points back at the same object instead of nesting forever", () => {
  const page = doc("page", "page", { menu: { _ref: "menu" } });
  const menu = doc("menu", "menu", { links: [{ _ref: "page" }] });
  const out = resolve({ document: page, references: [page, menu] }) as Record<string, any>;
  assert.equal(out.menu.links[0], out);
});

test("complete: fills a non-nullable null reference with an allowed candidate, leaves a nullable one", () => {
  const schema = { _type: "post", fields: {
    author: { type: "reference", allow: ["author"], nullable: false, default: null },
    editor: { type: "reference", allow: ["author"], nullable: true, default: null },
  } } as unknown as Schema;
  const ada = doc("ada", "author");
  const out = complete({ document: doc("p", "post", { author: null, editor: null }), schemas: [schema], references: [doc("x", "other"), ada] });
  assert.deepEqual(out.author, { _ref: "ada" });
  assert.equal(out.editor, null);
});
