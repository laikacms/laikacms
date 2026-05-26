/**
 * Type utilities for extracting TypeScript types from a Decap CMS config
 * loaded as a const-asserted value (e.g. the `config.gen.ts` produced by
 * `laika-local generate`).
 *
 * Given a field definition with `widget: 'string'`, `widget: 'list'`,
 * `widget: 'object'`, etc., these types recursively walk the field tree and
 * compute the corresponding TS shape. Use them to derive frontmatter/entry
 * prop types from the same source of truth the editor uses.
 *
 * Example:
 *
 *   import config from './config.gen';
 *   import { ExtractFieldsType } from '@laikacms/decap/decap-config-types';
 *
 *   type PagesCollection = Extract<
 *     typeof config['collections'][number],
 *     { name: 'pages' }
 *   >;
 *   type PageProps = ExtractFieldsType<PagesCollection['fields']>;
 */

/**
 * Maps each built-in Decap widget name to the TypeScript type its value takes.
 * Override or extend in user code by intersecting your own map.
 */
export interface WidgetTypeMap {
  string: string;
  text: string;
  markdown: string;
  number: number;
  boolean: boolean;
  datetime: string;
  date: string;
  image: string;
  file: string;
  select: string;
  hidden: string;
  code: string;
  color: string;
  map: { type: 'Point', coordinates: [number, number] };
  relation: string;
  object: Record<string, unknown>;
  list: unknown[];
  // Common third-party widgets shipped with @laikacms/decap.
  icon: string;
}

/** Fallback for widgets not present in `WidgetTypeMap`. */
export type DefaultWidgetType = unknown;

/**
 * Decap fields default to `required: true`. This evaluates to `false` only
 * when the field literally declares `required: false`.
 */
export type IsFieldRequired<F> = F extends { required: false } ? false : true;

/**
 * Partition a record into required/optional keys based on whether the value
 * type includes `undefined`. The complement of TypeScript's `Partial<T>`:
 * required keys stay required, optional keys (`T | undefined`) become `?:`.
 */
export type PartialByUndefined<T> =
  & {
    [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
  }
  & {
    [K in keyof T as undefined extends T[K] ? never : K]: T[K];
  };

/**
 * Extract the TypeScript value type for a single field definition based on
 * its `widget`. Handles:
 *   - `widget: 'list'` with nested `fields` → array of structured items
 *   - `widget: 'list'` with a single `field` template → array of that widget's type
 *   - `widget: 'object'` with `fields` → structured record
 *   - `widget: 'select'` with `options` (string list or `{ value }[]`) → union of literal values
 *   - any other widget → looked up in `WidgetTypeMap`, falling back to `DefaultWidgetType`
 */
export type ExtractFieldType<F> = F extends { widget: infer W, fields: infer Fields }
  ? W extends 'list' ? Fields extends readonly unknown[] ? ExtractFieldsType<Fields>[]
    : unknown[]
  : W extends 'object' ? Fields extends readonly unknown[] ? ExtractFieldsType<Fields>
    : Record<string, unknown>
  : W extends keyof WidgetTypeMap ? WidgetTypeMap[W]
  : DefaultWidgetType
  : F extends { widget: infer W, field: infer Field }
    ? W extends 'list' ? Field extends { widget: infer FW } ? FW extends keyof WidgetTypeMap ? WidgetTypeMap[FW][]
        : unknown[]
      : unknown[]
    : W extends keyof WidgetTypeMap ? WidgetTypeMap[W]
    : DefaultWidgetType
  : F extends { widget: infer W, options: infer Options }
    ? W extends 'select' ? Options extends readonly { value: infer V }[] ? V
      : Options extends readonly (infer O)[] ? O
      : string
    : W extends keyof WidgetTypeMap ? WidgetTypeMap[W]
    : DefaultWidgetType
  : F extends { widget: infer W } ? W extends keyof WidgetTypeMap ? WidgetTypeMap[W]
    : DefaultWidgetType
  : DefaultWidgetType;

/**
 * Extract the TypeScript value type for an array of field definitions, keyed
 * by each field's `name`. Required fields stay required; `required: false`
 * fields become optional via `PartialByUndefined`.
 */
export type ExtractFieldsType<Fields> = Fields extends readonly unknown[] ? PartialByUndefined<
    {
      [K in Fields[number] as K extends { name: infer N extends string } ? N : never]: K extends { name: string }
        ? IsFieldRequired<K> extends true ? ExtractFieldType<K>
        : ExtractFieldType<K> | undefined
        : never;
    }
  >
  : Record<string, unknown>;
