/**
 * JSON Schema → Zod, for deriving an Astro collection schema from the catalog.
 *
 * Scope is deliberately the subset `CatalogProvider.getCollectionSchema`
 * produces — for the Decap provider that is the mapping of its field widgets, so
 * this handles objects, arrays, enums, the four scalars, and the two date
 * formats, and nothing else. Anything unrecognised becomes `unknown()`, which
 * validates everything: a schema we cannot express must not start rejecting a
 * user's valid content.
 *
 * Zod itself is not a dependency. The caller passes the `z` they already
 * imported from `astro:content`, so there is exactly one Zod in the build and no
 * version to keep in step — the same reasoning that keeps `LoaderContext` out of
 * this package's public signatures.
 */

import type { JSONSchema7, JSONSchema7Definition, JSONSchema7TypeName } from 'json-schema';

/**
 * The slice of Zod's namespace this conversion uses.
 *
 * Parameters are `any` on purpose. Zod brands its schemas with an internal
 * `_zod` property, so a structurally-typed placeholder is not assignable to
 * `z.array`'s or `z.object`'s parameters — and the whole namespace would then
 * fail to match the real `z` a caller passes in. Widening the inputs is what
 * keeps this a compatibility boundary rather than a reimplementation of Zod's
 * type algebra. Return values stay opaque so our own code remains checked.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ZodNamespace {
  string(): ZodTypeLike;
  number(): ZodTypeLike;
  boolean(): ZodTypeLike;
  unknown(): ZodTypeLike;
  array(item: any): ZodTypeLike;
  object(shape: any): ZodTypeLike;
  enum(values: any): ZodTypeLike;
  union(options: any): ZodTypeLike;
  coerce: { date(): ZodTypeLike };
  /**
   * A permissive object that *keeps* unknown keys.
   *
   * Load-bearing: `z.object({})` strips every key it does not declare, so using
   * it as a placeholder schema would silently empty `entry.data` for every
   * entry in the collection.
   */
  looseObject(shape: any): ZodTypeLike;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * A Zod schema, seen only as "a thing that can be made optional".
 *
 * No index signature: a real Zod schema is a class instance, and a class is not
 * assignable to a type with an index signature — which would make the whole
 * `ZodNamespace` reject the actual `z` from `astro:content`.
 */
export interface ZodTypeLike {
  optional(): ZodTypeLike;
}

/**
 * Convert a collection's JSON Schema into a Zod object schema.
 *
 * Only the top level is special-cased: Astro expects an object schema for a
 * collection, so a non-object schema (or one with no properties) yields a
 * passthrough rather than an error.
 */
export function jsonSchemaToZod(schema: JSONSchema7, z: ZodNamespace): ZodTypeLike {
  const converted = convert(schema, z);
  return converted ?? z.object({});
}

function convert(schema: JSONSchema7Definition | undefined, z: ZodNamespace): ZodTypeLike | undefined {
  // `true` means "anything"; `false` means "nothing", which we cannot express
  // usefully and which no catalog produces.
  if (schema === undefined || typeof schema === 'boolean') return z.unknown();

  // A variable-type list's items. Checked before `type` because such a schema
  // carries no `type` of its own and would otherwise fall through to
  // `z.unknown()`, throwing away the one thing that makes the variants useful.
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const members = schema.anyOf.map(one => convert(one, z) ?? z.unknown());
    return members.length > 1 ? z.union(members) : members[0]!;
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) return enumOf(schema.enum, z);

  const type = normalizeType(schema.type);
  if (type === undefined) return z.unknown();

  if (Array.isArray(type)) {
    const members = type.map(one => convertScalar(one, schema, z));
    return members.length > 1 ? z.union(members) : members[0] ?? z.unknown();
  }

  return convertScalar(type, schema, z);
}

function convertScalar(
  type: JSONSchema7TypeName,
  schema: JSONSchema7,
  z: ZodNamespace,
): ZodTypeLike {
  switch (type) {
    case 'string':
      // Decap's date and datetime widgets store an ISO string, but a template
      // wants a Date. Coercing here is what lets a page write
      // `post.data.date.getTime()` without every project re-declaring it.
      return schema.format === 'date' || schema.format === 'date-time'
        ? z.coerce.date()
        : z.string();
    case 'integer':
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'array':
      return z.array(convert(itemSchema(schema.items), z) ?? z.unknown());
    case 'object':
      return objectOf(schema, z);
    default:
      return z.unknown();
  }
}

function objectOf(schema: JSONSchema7, z: ZodNamespace): ZodTypeLike {
  const properties = schema.properties;
  if (properties === undefined) return z.unknown();

  const required = new Set(schema.required ?? []);
  const shape: Record<string, ZodTypeLike> = {};
  for (const [name, property] of Object.entries(properties)) {
    const converted = convert(property, z) ?? z.unknown();
    shape[name] = required.has(name) ? converted : converted.optional();
  }
  return z.object(shape);
}

/**
 * A tuple `items` describes positional entries, which no catalog emits and Zod
 * models differently. Falling back to the permissive branch keeps the
 * conversion total.
 */
function itemSchema(items: JSONSchema7['items']): JSONSchema7Definition | undefined {
  if (items === undefined || Array.isArray(items)) return undefined;
  return items;
}

function enumOf(values: readonly unknown[], z: ZodNamespace): ZodTypeLike {
  const strings = values.filter((value): value is string => typeof value === 'string');
  if (strings.length === values.length && strings.length > 0) return z.enum(strings);
  // A mixed-type enum (Decap allows numeric select options) cannot be a Zod
  // enum, and the values still need to validate.
  return z.unknown();
}

function normalizeType(
  type: JSONSchema7['type'],
): JSONSchema7TypeName | JSONSchema7TypeName[] | undefined {
  if (type === undefined) return undefined;
  return type;
}
