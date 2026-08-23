import { describe, expect, it } from 'vitest';

import { type DateType, jsonSchemaToTypeExpression, jsonSchemaToTypeScript } from './json-schema-to-types.js';

/** The rendered type body, without the banner or the `export type Entry =` head. */
const entryType = (schema: Parameters<typeof jsonSchemaToTypeScript>[0]) =>
  jsonSchemaToTypeScript(schema)
    .replace(/^\/\/.*$/gm, '')
    .replace(/export type Entry = /, '')
    .replace(/;\s*$/, '')
    .trim();

describe('jsonSchemaToTypeScript', () => {
  it('renders required and optional properties', () => {
    const source = entryType({
      type: 'object',
      properties: { title: { type: 'string' }, draft: { type: 'boolean' } },
      required: ['title'],
    });

    expect(source).toContain('title: string;');
    expect(source).toContain('draft?: boolean;');
  });

  it('renders a date-formatted string as Date, matching the Zod coercion', () => {
    // If these two disagree the checker promises a shape validation does not
    // produce, which is worse than having no types at all.
    const source = entryType({
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time' },
        on: { type: 'string', format: 'date' },
        plain: { type: 'string' },
      },
      required: ['at', 'on', 'plain'],
    });

    expect(source).toContain('at: Date;');
    expect(source).toContain('on: Date;');
    expect(source).toContain('plain: string;');
  });

  it('renders integers and numbers alike', () => {
    const source = entryType({
      type: 'object',
      properties: { count: { type: 'integer' }, ratio: { type: 'number' } },
      required: ['count', 'ratio'],
    });

    expect(source).toContain('count: number;');
    expect(source).toContain('ratio: number;');
  });

  it('renders an array', () => {
    const source = entryType({
      type: 'object',
      properties: { tags: { type: 'array', items: { type: 'string' } } },
      required: ['tags'],
    });

    expect(source).toContain('tags: Array<string>;');
  });

  it('renders a string enum as a union of literals', () => {
    const source = entryType({
      type: 'object',
      properties: { status: { type: 'string', enum: ['draft', 'live'] } },
      required: ['status'],
    });

    expect(source).toContain('status: "draft" | "live";');
  });

  it('falls back to unknown for a mixed enum, matching the Zod side', () => {
    const source = entryType({
      type: 'object',
      properties: { level: { enum: ['a', 1] } },
      required: ['level'],
    });

    expect(source).toContain('level: unknown;');
  });

  it('nests objects', () => {
    const source = entryType({
      type: 'object',
      properties: {
        author: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      },
      required: ['author'],
    });

    expect(source).toMatch(/author: \{\s*name: string;\s*\}/);
  });

  it('quotes a property name that is not a bare identifier', () => {
    const source = entryType({
      type: 'object',
      properties: { 'og:title': { type: 'string' } },
      required: ['og:title'],
    });

    expect(source).toContain('"og:title": string;');
  });

  it('renders unknown for a type it cannot express', () => {
    const source = entryType({
      type: 'object',
      properties: { weird: { type: 'null' } },
      required: ['weird'],
    });

    expect(source).toContain('weird: unknown;');
  });

  it('produces a module Astro can import an Entry type from', () => {
    const source = jsonSchemaToTypeScript(
      { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
      'posts',
    );

    expect(source).toContain('export type Entry =');
    expect(source).toContain('posts');
    expect(source.endsWith('\n')).toBe(true);
  });

  it('renders a variable-type list as a union of its variants', () => {
    const source = entryType({
      type: 'object',
      properties: {
        blocks: {
          type: 'array',
          items: {
            anyOf: [
              {
                type: 'object',
                properties: { type: { type: 'string', enum: ['quote'] }, text: { type: 'string' } },
                required: ['type', 'text'],
              },
              {
                type: 'object',
                properties: { type: { type: 'string', enum: ['image'] }, src: { type: 'string' } },
                required: ['type', 'src'],
              },
            ],
          },
        },
      },
      required: ['blocks'],
    });

    expect(source).toContain('type: "quote";');
    expect(source).toContain('type: "image";');
    expect(source).toContain('text: string;');
    expect(source).toContain('src: string;');
    // The two variants are alternatives, not one merged shape.
    expect(source).toContain('} | {');
  });
});

describe('jsonSchemaToTypeExpression', () => {
  const dateProperty = (dateType: DateType) =>
    jsonSchemaToTypeExpression(
      {
        type: 'object',
        properties: { at: { type: 'string', format: 'date-time' } },
        required: ['at'],
      },
      { dateType },
    );

  it('defaults dates to Date, matching the build-time Zod coercion', () => {
    expect(dateProperty('Date')).toContain('at: Date;');
  });

  it('widens dates for a path where nothing coerces', () => {
    // The live loader hands back whatever the serializer produced unless that
    // loader opted into validation. Claiming `Date` there would be a lie the
    // checker cannot catch.
    expect(dateProperty('string | Date')).toContain('at: string | Date;');
  });

  it('indents from the requested depth, for embedding in an interface', () => {
    const source = jsonSchemaToTypeExpression(
      { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
      { depth: 2 },
    );

    expect(source).toContain('\n      title: string;');
    expect(source.endsWith('    }')).toBe(true);
  });
});
