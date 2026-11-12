import * as z from "zod";
import { DateSchema, DateTimeSchema, ColorSchema, UrlSchema, EmailSchema } from "./primitives.js";
import type { Reference, Fragment, TextFragment, RichTextFragment, ImageFragment } from "./fragment.js";
import type { Schema } from "./schema.js";

export const BaseFieldSchema = z.object({
  label: z.string().optional(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  hidden: z.boolean().optional(),
  immutable: z.boolean().optional(),
  nullable: z.boolean().optional(),
});

export type BaseField = z.infer<typeof BaseFieldSchema>;

export const StringFieldSchema = BaseFieldSchema.extend({
  type: z.literal("string"),
  default: z.string().nullable().optional(),
  min: z.number().int().min(0).optional(),
  max: z.number().int().min(0).optional(),
});

export type StringField = z.infer<typeof StringFieldSchema>;

export const NumberFieldSchema = BaseFieldSchema.extend({
  type: z.literal("number"),
  default: z.number().nullable().optional(),
  step: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export type NumberField = z.infer<typeof NumberFieldSchema>;

export const BooleanFieldSchema = BaseFieldSchema.extend({
  type: z.literal("boolean"),
  default: z.boolean().nullable().optional(),
});

export type BooleanField = z.infer<typeof BooleanFieldSchema>;

export const DateFieldSchema = BaseFieldSchema.extend({
  type: z.literal("date"),
  default: DateSchema.nullable().optional(),
});

export type DateField = z.infer<typeof DateFieldSchema>;

export const DateTimeFieldSchema = BaseFieldSchema.extend({
  type: z.literal("datetime"),
  default: DateTimeSchema.nullable().optional(),
});

export type DateTimeField = z.infer<typeof DateTimeFieldSchema>;

export const ColorFieldSchema = BaseFieldSchema.extend({
  type: z.literal("color"),
  default: ColorSchema.nullable().optional(),
});

export type ColorField = z.infer<typeof ColorFieldSchema>;

export const OptionFieldSchema = BaseFieldSchema.extend({
  type: z.literal("option"),
  default: z.string().nullable().optional(),
  options: z.array(z.object({
    label: z.string().optional(),
    value: z.string()
  })),
});

export type OptionField<TOptions extends string = string> = z.infer<typeof OptionFieldSchema> & {
  default?: TOptions | null;
  options: { label?: string; value: TOptions }[];
};

export const ReferenceFieldSchema = BaseFieldSchema.extend({
  type: z.literal("reference"),
  default: z.string().nullable().optional(),
  allow: z.array(z.string()),
});

export type ReferenceField = z.infer<typeof ReferenceFieldSchema>;

export const ReferencesFieldSchema = BaseFieldSchema.extend({
  type: z.literal("references"),
  default: z.array(z.string()).nullable().optional(),
  allow: z.array(z.string()),
  min: z.number().int().min(0).optional(),
  max: z.number().int().min(0).optional(),
});

export type ReferencesField = z.infer<typeof ReferencesFieldSchema>;

export const UrlFieldSchema = BaseFieldSchema.extend({
  type: z.literal("url"),
  default: UrlSchema.nullable().optional(),
});
export type UrlField = z.infer<typeof UrlFieldSchema>;

export const EmailFieldSchema = BaseFieldSchema.extend({
  type: z.literal("email"),
  default: EmailSchema.nullable().optional(),
  min: z.number().int().min(0).optional(),
  max: z.number().int().min(0).optional(),
});

export type EmailField = z.infer<typeof EmailFieldSchema>;

export const TextFieldSchema = BaseFieldSchema.extend({
  type: z.literal("text"),
  default: z.array(z.custom<TextFragment>()).nullable().optional(),
});

export type TextField = z.infer<typeof TextFieldSchema>;

export const RichTextFieldSchema = BaseFieldSchema.extend({
  type: z.literal("richtext"),
  default: z.array(z.custom<RichTextFragment>()).nullable().optional(),
  min: z.number().int().min(0).optional(),
  max: z.number().int().min(0).optional(),
  allow: z.array(z.string()).optional(),
});

export type RichTextField = z.infer<typeof RichTextFieldSchema>;

export const ImageFieldSchema = BaseFieldSchema.extend({
  type: z.literal("image"),
  default: z.custom<ImageFragment>().nullable().optional(),
});

export type ImageField = z.infer<typeof ImageFieldSchema>;

export const FragmentFieldSchema = BaseFieldSchema.extend({
  type: z.literal("fragment"),
  default: z.custom<Fragment>().nullable().optional(),
  allow: z.array(z.string()),
});

export type FragmentField<T extends Fragment = Fragment> = z.infer<typeof FragmentFieldSchema> & {
  default?: T | null;
};

export const FragmentsFieldSchema = BaseFieldSchema.extend({
  type: z.literal("fragments"),
  default: z.array(z.custom<Fragment>()).nullable().optional(),
  allow: z.array(z.string()).catch([]),
  min: z.number().optional(),
  max: z.number().optional(),
});

export type FragmentsField<T extends Fragment = Fragment> = z.infer<typeof FragmentsFieldSchema> & {
  default?: T[] | null;
};

export const FieldSchema = z.union([
  StringFieldSchema,
  NumberFieldSchema,
  BooleanFieldSchema,
  DateFieldSchema,
  DateTimeFieldSchema,
  ColorFieldSchema,
  OptionFieldSchema,
  ReferenceFieldSchema,
  ReferencesFieldSchema,
  TextFieldSchema,
  RichTextFieldSchema,
  ImageFieldSchema,
  UrlFieldSchema,
  EmailFieldSchema,
  FragmentFieldSchema,
  FragmentsFieldSchema,
]);

export type Fields =
  | StringField
  | NumberField
  | BooleanField
  | DateField
  | DateTimeField
  | ColorField
  | OptionField
  | ReferenceField
  | ReferencesField
  | TextField
  | RichTextField
  | ImageField
  | UrlField
  | EmailField
  | FragmentField
  | FragmentsField

export type Props = InferField<Fields>;

type InferFieldValue<T extends Fields> =
  T extends { type: "string" } ? string :
  T extends { type: "number" } ? number :
  T extends { type: "boolean" } ? boolean :
  T extends OptionField<infer TOptions> ? TOptions :
  T extends { type: "reference" } ? Reference :
  T extends { type: "references" } ? Reference[] :
  T extends { type: "text" } ? TextFragment[] :
  T extends { type: "richtext" } ? RichTextFragment[] :
  T extends { type: "image" } ? ImageFragment :
  T extends { type: "url" } ? string :
  T extends { type: "email" } ? string :
  T extends { type: "date" } ? string :
  T extends { type: "datetime" } ? string :
  T extends { type: "color" } ? string :
  T extends FragmentField<infer F> ? F :
  T extends FragmentsField<infer F> ? F[] :
  never;

export type InferField<T extends Fields> =
  T extends { nullable: true } ? InferFieldValue<T> | null : InferFieldValue<T>;

export type InferFields<TProps extends Record<string, Fields>> = {
  [K in keyof TProps]: InferField<TProps[K]>;
}

export type Infer<T extends Schema> = T extends Schema<infer TFields>
  ? { _type: string } & InferFields<TFields>
  : never;

export function isField(value: unknown): value is Fields {
  return FieldSchema.safeParse(value).success;
}
