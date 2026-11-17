import { test } from "node:test";
import assert from "node:assert/strict";
import { complete, resolve, resolver, DEFAULT_MAX_REFERENCES } from "./index.js";
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

test("complete: a non-nullable null references field gets up to `max` candidates, DEFAULT_MAX_REFERENCES without one", () => {
  const schema = { _type: "post", fields: {
    capped: { type: "references", allow: ["author"], max: 2, default: null },
    open: { type: "references", allow: ["author"], default: null },
  } } as unknown as Schema;
  const authors = Array.from({ length: DEFAULT_MAX_REFERENCES + 5 }, (_, i) => doc(`a${i}`, "author"));
  const out = complete({ document: doc("p", "post", { capped: null, open: null }), schemas: [schema], references: [doc("x", "other"), ...authors] }) as Record<string, any>;
  assert.deepEqual(out.capped, [{ _ref: "a0" }, { _ref: "a1" }]);
  assert.equal(out.open.length, DEFAULT_MAX_REFERENCES);
  assert.deepEqual(out.open[0], { _ref: "a0" });
});

test("resolver: a document reached from two pages is the same object on both, as is a page reached from another", () => {
  const site = doc("site", "site", { name: "Acme" });
  const home = doc("home", "page", { site: { _ref: "site" }, next: { _ref: "about" } });
  const about = doc("about", "page", { site: { _ref: "site" } });
  const resolve = resolver({ references: [site, home, about] });
  const a = resolve(home) as Record<string, any>;
  const b = resolve(about) as Record<string, any>;
  assert.equal(a.site, b.site);
  assert.equal(a.next, b);
  assert.equal(b.site.name, "Acme");
});

test("complete: warns where DEFAULT_MAX_REFERENCES cut a field short, not for a field's own max or when everything fit", () => {
  const card = { _type: "card", fields: { related: { type: "references", allow: ["author"], default: null } } } as unknown as Schema;
  const post = { _type: "post", fields: {
    open: { type: "references", allow: ["author"], default: null },
    capped: { type: "references", allow: ["author"], max: 2, default: null },
    few: { type: "references", allow: ["other"], default: null },
    blocks: { type: "fragments", allow: ["card"], default: null },
  } } as unknown as Schema;
  const authors = Array.from({ length: DEFAULT_MAX_REFERENCES + 5 }, (_, i) => doc(`a${i}`, "author"));
  const warnings: string[] = [];
  complete({ document: doc("p", "post", { open: null, capped: null, few: null, blocks: [{ _type: "card", related: null }] }), schemas: [post, card], references: [doc("x", "other"), ...authors], warnings });
  const message = (at: string) => `${at}: Left empty, so filled with the first ${DEFAULT_MAX_REFERENCES} of ${authors.length} matching documents. Set a max to choose how many, or nullable`;
  assert.deepEqual(warnings, [message("open"), message("blocks.0.related")]);
});
