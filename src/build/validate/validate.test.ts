import { test } from "node:test";
import assert from "node:assert/strict";
import * as validate from "./index.js";
import { validateProp } from "./document.js";
import type { Document, Fields, Schema } from "../../model/types/index.js";
import { builtins } from "../builtins.js";
import { RICHTEXT_TYPES } from "../../model/types/index.js";

const string = { type: "string", default: "Untitled" } as Fields;
const number = { type: "number", default: 0, min: 1, max: 5 } as Fields;
const post = { _type: "post", document: true, fields: { title: string, tags: { type: "fragments", allow: ["tag"], default: [] } } } as unknown as Schema;
const tag = { _type: "tag", fields: { name: { type: "string", default: "" } } } as unknown as Schema;
const schemas = [post, tag];
const doc = (data: Record<string, unknown>) => ({ _id: "a", _type: "post", _path: "/a.yml", _extension: "yml", _hidden: false, _data: "", _size: 0, _raw: null, _created_at: "", _updated_at: "", ...data }) as Document;

test("validateProp: a valid value passes, with nothing reported", () => {
  const errors: string[] = [];
  assert.equal(validateProp({ value: "Hi", field: string, schemas, errors }), "Hi");
  assert.deepEqual(errors, []);
});

test("validateProp: an invalid value throws without `errors`, is replaced by the default and reported with them", () => {
  assert.throws(() => validateProp({ value: 3, field: string, schemas }), /Expected string/);
  const errors: string[] = [];
  assert.equal(validateProp({ value: 3, field: string, schemas, errors }), "Untitled");
  assert.deepEqual(errors, ["Expected string, got number"]);
});

test("validateProp: an out-of-range number is kept and reported", () => {
  const errors: string[] = [];
  assert.equal(validateProp({ value: 9, field: number, schemas, errors }), 9);
  assert.deepEqual(errors, ["Number 9 exceeds maximum 5"]);
});

test("validateProp: a disallowed fragment is dropped and reported, the rest kept", () => {
  const errors: string[] = [];
  const value = [{ _type: "tag", name: "x" }, { _type: "post" }];
  assert.deepEqual(validateProp({ value, field: post.fields.tags, schemas, errors }), [{ _type: "tag", name: "x" }]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /"post" is not allowed/);
});

test("validate.document: collects every error in one pass", () => {
  const errors: string[] = [];
  const result = validate.document({ document: doc({ title: 3, tags: "nope" }), schemas, errors });
  assert.equal(result!.title, "Untitled");
  assert.deepEqual(result!.tags, []);
  assert.equal(errors.length, 2);
});

test("validate.document: each message says which field it's about, through fragments and arrays", () => {
  const errors: string[] = [];
  validate.document({ document: doc({ title: 3, tags: [{ _type: "tag", name: 1 }, "nope", { _type: "post" }] }), schemas, errors });
  assert.deepEqual(errors, [
    "title: Expected string, got number",
    "tags.0.name: Expected string, got number",
    "tags.1: Expected object in fragments array, got string",
    'tags.2: Fragment type "post" is not allowed (allowed: tag)',
  ]);
});

test("validate.schema: each message says which field definition it's about", () => {
  const errors: string[] = [];
  validate.schema({ schema: { _type: "x", fields: { size: { type: "option", options: [{ label: "S", value: "s" }], default: "xl" } } } as unknown as Schema, errors });
  assert.match(errors[0], /^fields\.size: /);
});

test("validate.document: an unknown _type is null and reported, or throws", () => {
  const errors: string[] = [];
  assert.equal(validate.document({ document: doc({ _type: "nope" }), schemas, errors }), null);
  assert.deepEqual(errors, ['No schema found for document type "nope"']);
  assert.throws(() => validate.document({ document: doc({ _type: "nope" }), schemas }));
});

test("validate.schema: an option default outside its options is fixed and reported", () => {
  const errors: string[] = [];
  const schema = { _type: "x", fields: { size: { type: "option", options: [{ label: "S", value: "s" }], default: "xl" } } } as unknown as Schema;
  const result = validate.schema({ schema, errors });
  assert.equal((result!.fields.size as { default: string }).default, "s");
  assert.equal(errors.length, 1);
  assert.throws(() => validate.schema({ schema }));
});

test("validate: warnings are only collected, never thrown", () => {
  const warnings: string[] = [];
  validate.document({ document: doc({ title: "Hi" }), schemas, warnings });
  assert.deepEqual(warnings, []);
});

test("validate.document: a key the schema doesn't define is dropped and warned about, at any depth", () => {
  const warnings: string[] = [];
  const result = validate.document({ document: doc({ title: "Hi", subtitle: "x", tags: [{ _type: "tag", name: "a", color: "red", _id: "t" }] }), schemas, warnings });
  assert.equal(result!.subtitle, undefined);
  assert.deepEqual(warnings, ["subtitle: Not in the schema, so it's ignored", "tags.0.color: Not in the schema, so it's ignored"]);
  assert.doesNotThrow(() => validate.document({ document: doc({ subtitle: "x" }), schemas }));
});

test("validate.schema: with `schemas`, an allow naming a missing type and a context that isn't a singleton are warned about", () => {
  const warnings: string[] = [];
  const settings = { _type: "settings", document: true, singleton: true, fields: {} } as unknown as Schema;
  const schema = { _type: "x", fields: { blocks: { type: "fragments", allow: ["tag", "Herro"], default: [] } }, pull: { request: { url: "" }, context: "post" }, push: { request: { url: "" }, context: "settings" } } as unknown as Schema;
  validate.schema({ schema, schemas: [...schemas, settings], warnings });
  assert.deepEqual(warnings, ['fields.blocks: Type "Herro" doesn\'t exist', 'pull.context: "post" isn\'t a singleton schema']);
  const without: string[] = [];
  validate.schema({ schema, warnings: without });
  assert.deepEqual(without, []);
});

test("validate.schema: a type that isn't a valid name or is an HTML tag is null and reported, or throws", () => {
  const errors: string[] = [];
  assert.equal(validate.schema({ schema: { _type: "my-thing", fields: {} } as unknown as Schema, errors }), null);
  assert.equal(validate.schema({ schema: { _type: "menu", fields: {} } as unknown as Schema, errors }), null);
  assert.deepEqual(errors.map((e) => e.split(":")[0]), ["_type", "_type"]);
  assert.match(errors[1], /"menu" is an HTML tag/);
  assert.throws(() => validate.schema({ schema: { _type: "p", fields: {} } as unknown as Schema }));
});

test("validate.schema: a pull.map without the key is warned about", () => {
  const warnings: string[] = [];
  const handle = { type: "string", default: null, nullable: true, immutable: true };
  const schema = (map: Record<string, string>) => ({ _type: "product", document: true, key: "handle", fields: { handle }, pull: { request: { url: "" }, map } }) as unknown as Schema;
  validate.schema({ schema: schema({ title: "name" }), warnings });
  validate.schema({ schema: schema({ handle: "slug" }), warnings });
  assert.deepEqual(warnings, ['pull.map: must set the key "handle"']);
});

test("validate.schema: a key names a nullable, immutable field defaulting to null, of a document or form schema, else it's dropped and reported", () => {
  const handle = { type: "string", default: null, nullable: true, immutable: true } as unknown as Fields;
  const ok = { _type: "product", document: true, key: "handle", fields: { handle } } as unknown as Schema;
  assert.equal(validate.schema({ schema: ok })!.key, "handle");

  const cases: [Partial<Schema>, RegExp][] = [
    [{ key: "nope" }, /"nope" isn't a field/],
    [{ fields: { handle: { ...handle, type: "boolean" } as Fields } }, /must be a string, number, email field, not boolean/],
    [{ fields: { handle: { ...handle, type: "url" } as Fields } }, /must be a string, number, email field, not url/],
    [{ fields: { handle: { ...handle, immutable: false } } }, /must be nullable and immutable, with default null/],
    [{ fields: { handle: { ...handle, default: "" } as Fields } }, /with default null/],
    [{ document: false }, /only a document/],
    [{ singleton: true }, /not a singleton/],
  ];
  for (const [change, message] of cases) {
    const errors: string[] = [];
    assert.equal(validate.schema({ schema: { ...ok, ...change } as Schema, errors })!.key, undefined);
    assert.match(errors[0], message);
  }
});

test("validate.schema: a null default is kept on a nullable field, and replaced by the empty value elsewhere", () => {
  const errors: string[] = [];
  const fields = validate.fields({ fields: {
    a: { type: "string", nullable: true, default: null, min: 3 } as unknown as Fields,
    b: { type: "number", default: null } as unknown as Fields,
    c: { type: "fragment", nullable: true, allow: ["tag"], default: null } as unknown as Fields,
    d: { type: "reference", allow: ["post"], default: null } as unknown as Fields,
  }, errors });
  assert.equal(fields.a.default, null);
  assert.equal(fields.b.default, 0);
  assert.equal(fields.c.default, null);
  assert.equal(fields.d.default, null);
  assert.deepEqual(errors, ["fields.b: Field default can only be null when the field is nullable"]);
});

test("validateProp: richtext always takes built-in types, and a custom type only when `allow` lists it", () => {
  const faq = { _type: "faq", fields: { q: { type: "string", default: "" } } } as unknown as Schema;
  const all = [...builtins, tag, faq];
  const field = { type: "richtext", allow: ["tag"], default: [] } as Fields;
  const errors: string[] = [];
  const value = [{ _type: "p", children: [{ _type: "text", text: "Hi" }] }, { _type: "tag", name: "x" }, { _type: "faq", q: "?" }];
  const result = validateProp({ value, field, schemas: all, errors }) as { _type: string }[];
  assert.deepEqual(result.map((f) => f._type), ["p", "tag"]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0], '2: Fragment type "faq" is not allowed (allowed: text, a, img, h1, h2, h3, h4, h5, h6, p, ul, ol, tag)');
  /* Without `allow`, built-in types only */
  const strict: string[] = [];
  const plain = validateProp({ value, field: { type: "richtext", default: [] } as Fields, schemas: all, errors: strict }) as { _type: string }[];
  assert.deepEqual(plain.map((f) => f._type), ["p"]);
  assert.deepEqual(strict.map((e) => e.split(":")[0]), ["1", "2"]);
  assert.match(strict[0], /\(allowed: text, a, img, h1, h2, h3, h4, h5, h6, p, ul, ol\)$/);
});

test("validate.fields: a richtext default drops the custom types its `allow` doesn't list", () => {
  const errors: string[] = [];
  const fields = validate.fields({ fields: { body: { type: "richtext", allow: ["tag"], default: [{ _type: "p", children: [] }, { _type: "tag" }, { _type: "faq" }] } as Fields }, errors });
  assert.deepEqual((fields.body.default as { _type: string }[]).map((f) => f._type), ["p", "tag"]);
  assert.equal(errors[0], 'fields.body: Field default: Fragment type "faq" is not allowed (allowed: text, a, img, h1, h2, h3, h4, h5, h6, p, ul, ol, tag)');
});

test("validateProp: an image field only takes an img fragment", () => {
  const field = { type: "image", default: { _type: "img", src: "", alt: "" } } as Fields;
  const all = [...builtins, tag];
  const errors: string[] = [];
  assert.deepEqual(validateProp({ value: { _type: "img", src: "/a.png", alt: "A" }, field, schemas: all, errors }), { _type: "img", src: "/a.png", alt: "A" });
  assert.deepEqual(validateProp({ value: { _type: "tag", name: "x" }, field, schemas: all, errors }), { _type: "img", src: "", alt: "" });
  assert.deepEqual(errors, ['Expected an image (img) fragment, got "tag"']);
});

test("rejects: every built-in rich text type has a built-in schema", () => {
  for (const type of RICHTEXT_TYPES) assert.ok(builtins.some((s) => s._type === type), type);
});

test("validate.fields: a fragments default drops the types it doesn't take, then pads to min; a fragment or image default of the wrong type is its empty value", () => {
  const errors: string[] = [];
  const fields = validate.fields({ errors, fields: {
    tags: { type: "fragments", allow: ["tag"], min: 2, default: [{ _type: "tag" }, { _type: "faq" }] } as Fields,
    hero: { type: "fragment", allow: ["tag"], default: { _type: "faq" } } as Fields,
    cover: { type: "image", default: { _type: "tag" } } as unknown as Fields,
  } });
  assert.deepEqual(fields.tags.default, [{ _type: "tag" }, { _type: "tag" }]);
  assert.deepEqual(fields.hero.default, { _type: "tag" });
  assert.deepEqual(fields.cover.default, { _type: "img", src: "", alt: "" });
  assert.deepEqual(errors, [
    'fields.tags: Field default: Fragment type "faq" is not allowed (allowed: tag)',
    "fields.tags: Field default length 1 is less than min 2",
    'fields.hero: Field default: Fragment type "faq" is not allowed (allowed: tag)',
    'fields.cover: Field default: Expected an image (img) fragment, got "tag"',
  ]);
});
