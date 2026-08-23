/**
 * Deriving collections from a catalog, against the real providers.
 *
 * The point of `laikaCollections` is that a project declares its collections
 * once. These tests check that claim end to end: write a CMS config, derive the
 * collections, and assert the schema really validates the fields that config
 * declared — including which ones are optional.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
// The exact zod Astro ships, so the conversion is tested against what
// `astro:content` would hand a real project.
import * as zod from 'astro/zod';

import { laikaCollections } from './collections.js';
import { documentsLoader } from './documents-loader.js';
import { jsonSchemaToZod, type ZodNamespace } from './json-schema-to-zod.js';
import { objectsLoader } from './objects-loader.js';

const z = zod.z as unknown as ZodNamespace;
const parse = (schema: unknown, value: unknown) =>
  (schema as { safeParse(v: unknown): { success: boolean, data?: unknown } }).safeParse(value);

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

const DECAP_CONFIG = `
backend:
  name: laika
media_folder: public/uploads
collections:
  - name: posts
    label: Blog Posts
    folder: posts
    fields:
      - { label: Title, name: title, widget: string }
      - { label: Date, name: date, widget: datetime }
      - { label: Draft, name: draft, widget: boolean, required: false }
      - { label: Rating, name: rating, widget: number, value_type: int, required: false }
      - { label: Tags, name: tags, widget: list, field: { name: tag, widget: string }, required: false }
      - { label: Status, name: status, widget: select, options: ['a', 'b'], required: false }
      - { label: Body, name: body, widget: markdown }
  - name: pages
    label: Pages
    folder: site-pages
    fields:
      - { label: Title, name: title, widget: string }
`;

async function createProject(config = DECAP_CONFIG): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-astro-cat-'));
  tempDirs.push(dir);
  await fs.writeFile(path.join(dir, 'config.yml'), config);
  await fs.mkdir(path.join(dir, 'posts'), { recursive: true });
  await fs.mkdir(path.join(dir, 'site-pages'), { recursive: true });
  return dir;
}

const derive = (root: string, overrides: Record<string, unknown> = {}) =>
  laikaCollections({ dir: '.', root, defaultExtension: 'md', catalog: 'decap', z, ...overrides });

describe('collection discovery', () => {
  it('finds every collection the CMS config declares', async () => {
    const root = await createProject();

    const collections = await derive(root);

    expect(Object.keys(collections).sort()).toEqual(['pages', 'posts']);
  });

  it('produces a content-layer collection with a loader for each', async () => {
    const root = await createProject();

    const { posts } = await derive(root);

    expect(posts.type).toBe('content_layer');
    expect(typeof posts.loader.load).toBe('function');
  });

  it('honours include and exclude', async () => {
    const root = await createProject();

    expect(Object.keys(await derive(root, { include: ['posts'] }))).toEqual(['posts']);
    expect(Object.keys(await derive(root, { exclude: ['posts'] }))).toEqual(['pages']);
  });

  it('fails loudly when the catalog enumerates nothing', async () => {
    const root = await createProject();

    // The convention catalog cannot enumerate; silently returning no
    // collections would look like a site that simply has no content.
    await expect(laikaCollections({ dir: '.', root, catalog: 'convention', z }))
      .rejects.toMatchObject({ code: 'bad_request' });
  });

  it('returns an empty set when that is explicitly expected', async () => {
    const root = await createProject();

    await expect(laikaCollections({ dir: '.', root, catalog: 'convention', z, allowEmpty: true }))
      .resolves.toEqual({});
  });
});

describe('schema derivation', () => {
  const schemaFor = async (name: string) => (await derive(await createProject()))[name]?.schema;

  it('requires the fields the CMS config marks required', async () => {
    const schema = await schemaFor('posts');

    expect(parse(schema, { title: 'Hi', date: '2026-01-01', body: '# Hi' }).success).toBe(true);
    // `title` is required — Decap's default — so omitting it must fail.
    expect(parse(schema, { date: '2026-01-01', body: '# Hi' }).success).toBe(false);
  });

  it('makes required: false fields optional', async () => {
    const schema = await schemaFor('posts');

    expect(parse(schema, { title: 'Hi', date: '2026-01-01', body: 'x' }).success).toBe(true);
    expect(parse(schema, { title: 'Hi', date: '2026-01-01', body: 'x', draft: true }).success)
      .toBe(true);
  });

  it('coerces a datetime field to a Date, so templates can format it', async () => {
    const schema = await schemaFor('posts');

    const result = parse(schema, { title: 'Hi', date: '2026-01-01T10:00:00Z', body: 'x' });
    expect(result.success).toBe(true);
    expect((result.data as { date: unknown }).date).toBeInstanceOf(Date);
  });

  it('rejects a wrongly-typed field', async () => {
    const schema = await schemaFor('posts');

    expect(parse(schema, { title: 42, date: '2026-01-01', body: 'x' }).success).toBe(false);
    expect(parse(schema, { title: 'Hi', date: '2026-01-01', body: 'x', draft: 'yes' }).success)
      .toBe(false);
  });

  it('carries list and select widgets across', async () => {
    const schema = await schemaFor('posts');

    expect(parse(schema, { title: 'a', date: '2026-01-01', body: 'x', tags: ['one'] }).success)
      .toBe(true);
    expect(parse(schema, { title: 'a', date: '2026-01-01', body: 'x', tags: 'one' }).success)
      .toBe(false);
    expect(parse(schema, { title: 'a', date: '2026-01-01', body: 'x', status: 'a' }).success)
      .toBe(true);
    expect(parse(schema, { title: 'a', date: '2026-01-01', body: 'x', status: 'z' }).success)
      .toBe(false);
  });

  it('excludes the body field, which never appears in data', async () => {
    // config.yml declares `body` as a required markdown widget, but the loader
    // puts prose on entry.body and entry.rendered, never in data. Leaving it in
    // the schema would fail every single entry.
    const schema = await schemaFor('posts');

    const result = parse(schema, { title: 'Hi', date: '2026-01-01' });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('body');
  });

  it('excludes a custom body field too', async () => {
    const root = await createProject(DECAP_CONFIG.replace('name: body', 'name: markdown'));

    const collections = await derive(root, { render: { bodyField: 'markdown' } });

    expect(parse(collections.posts?.schema, { title: 'Hi', date: '2026-01-01' }).success).toBe(true);
  });

  it('lets an explicit override replace the derived schema', async () => {
    const root = await createProject();
    const custom = z.object({ title: z.string() });

    const { posts } = await derive(root, { overrides: { posts: { schema: custom } } });

    expect(posts.schema).toBe(custom);
  });

  it('omits schemas entirely when no zod namespace is supplied', async () => {
    const root = await createProject();

    const collections = await laikaCollections({
      dir: '.',
      root,
      defaultExtension: 'md',
      catalog: 'decap',
    });

    expect(collections.posts?.schema).toBeUndefined();
  });
});

describe('the catalog directory mapping', () => {
  it('reads a collection whose folder differs from its name', async () => {
    // This is the case the convention catalog cannot express, and the reason
    // laikaCollections wires the loader through the same provider it enumerated
    // from: collection `pages` lives in `site-pages/`.
    const root = await createProject();
    await fs.writeFile(
      path.join(root, 'site-pages', 'about.md'),
      '---\ntitle: About\n---\nAbout us.\n',
    );

    const { pages } = await derive(root);
    const { createFakeLoaderContext } = await import('./testing/loader-context.js');
    const fake = createFakeLoaderContext({ collection: 'pages' });
    await pages!.loader.load({
      ...fake,
      config: { root: new URL(`file://${root}/`) },
    } as never);

    expect(fake.snapshot().get('about')?.data).toMatchObject({ title: 'About' });
  });
});

describe('jsonSchemaToZod', () => {
  it('falls back to permissive rather than rejecting what it cannot express', () => {
    // A schema we do not understand must not start failing a user's valid
    // content — the failure mode would be a broken build with no clear cause.
    const schema = jsonSchemaToZod(
      { type: 'object', properties: { weird: { type: 'null' } }, required: ['weird'] },
      z,
    );

    expect(parse(schema, { weird: null }).success).toBe(true);
    expect(parse(schema, { weird: 'anything' }).success).toBe(true);
  });

  it('handles a nested object field', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        author: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
      },
      required: ['author'],
    }, z);

    expect(parse(schema, { author: { name: 'Sem' } }).success).toBe(true);
    expect(parse(schema, { author: {} }).success).toBe(false);
  });

  it('produces an object schema even for a schema with no properties', () => {
    expect(parse(jsonSchemaToZod({ type: 'object' }, z), {}).success).toBe(true);
  });

  it('validates a variable-type list against the matching variant', () => {
    // A Decap `list` with `types` — the shape the catalog now emits for it.
    const schema = jsonSchemaToZod({
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
    }, z);

    expect(parse(schema, { blocks: [{ type: 'quote', text: 'hi' }] }).success).toBe(true);
    expect(parse(schema, { blocks: [{ type: 'image', src: '/a.png' }] }).success).toBe(true);
    // Right tag, wrong fields.
    expect(parse(schema, { blocks: [{ type: 'quote', src: '/a.png' }] }).success).toBe(false);
    // A tag no variant declares.
    expect(parse(schema, { blocks: [{ type: 'video', url: '/a.mp4' }] }).success).toBe(false);
  });
});

describe('documentsLoader.createSchema', () => {
  it('is offered only when it can be answered', async () => {
    const root = await createProject();

    // No `z`: nothing to build a schema with.
    expect(documentsLoader({ dir: '.', root, catalog: 'decap' }).createSchema).toBeUndefined();
    // No explicit collection: the name is not known until `load` runs, but Astro
    // calls createSchema before that — offering it would promise a schema we
    // cannot produce.
    expect(documentsLoader({ dir: '.', root, catalog: 'decap', z }).createSchema).toBeUndefined();

    expect(documentsLoader({ dir: '.', root, catalog: 'decap', z, collection: 'posts' }).createSchema)
      .toBeTypeOf('function');
  });

  it('derives a schema and matching entry types from the CMS config', async () => {
    const root = await createProject();
    const loader = documentsLoader({
      dir: '.',
      root,
      defaultExtension: 'md',
      catalog: 'decap',
      collection: 'posts',
      z,
    });

    const { schema, types } = await loader.createSchema!();

    expect(parse(schema, { title: 'Hi', date: '2026-01-01' }).success).toBe(true);
    expect(parse(schema, { date: '2026-01-01' }).success).toBe(false);

    // Astro writes this source out and types entries from its `Entry` export.
    expect(types).toContain('export type Entry =');
    expect(types).toContain('title: string;');
    expect(types).toContain('date: Date;');
    expect(types).toContain('draft?: boolean;');
    // The body never reaches `data`, so it must not appear in either half.
    expect(types).not.toContain('body');
  });
});

describe('type generation from content, when there is no field list', () => {
  it('objectsLoader describes the objects it finds', async () => {
    const root = await createProject();
    await fs.mkdir(path.join(root, 'settings'), { recursive: true });
    await fs.writeFile(path.join(root, 'settings', 'a.yaml'), 'label: A\nitems:\n  - one\n');
    await fs.writeFile(path.join(root, 'settings', 'b.yaml'), 'label: B\nnote: hi\n');

    const loader = objectsLoader({
      dir: '.',
      root,
      defaultExtension: 'yaml',
      select: { folder: 'settings' },
      z,
    });
    const { schema, types } = await loader.createSchema!();

    expect(types).toContain('label: string;');
    expect(types).toContain('items?: Array<string>;');
    expect(types).toContain('note?: string;');

    // The permissive schema must pass data through untouched. `z.object({})`
    // would silently return `{}` and empty every entry in the collection.
    expect(parse(schema, { label: 'A', items: ['one'] }).data)
      .toEqual({ label: 'A', items: ['one'] });
  });

  it('objectsLoader offers createSchema only when it can answer', async () => {
    const root = await createProject();

    expect(objectsLoader({ dir: '.', root, select: { folder: 'settings' } }).createSchema)
      .toBeUndefined();
    expect(objectsLoader({ dir: '.', root, z }).createSchema).toBeUndefined();
    expect(objectsLoader({ dir: '.', root, select: { folder: 'settings' }, z }).createSchema)
      .toBeTypeOf('function');
  });

  it('documentsLoader falls back to the content when the catalog describes no fields', async () => {
    const root = await createProject();
    await fs.writeFile(
      path.join(root, 'posts', 'one.md'),
      '---\ntitle: One\nweight: 3\n---\nBody.\n',
    );

    // catalog: 'convention' answers with an empty permissive schema, which is
    // no description at all — so the content is consulted instead.
    const loader = documentsLoader({
      dir: '.',
      root,
      defaultExtension: 'md',
      catalog: 'convention',
      collection: 'posts',
      z,
    });
    const { schema, types } = await loader.createSchema!();

    expect(types).toContain('title: string;');
    expect(types).toContain('weight: number;');
    // The body is never in `data`, so it must not appear in the types either.
    expect(types).not.toContain('body');
    expect(parse(schema, { title: 'One', weight: 3 }).data).toEqual({ title: 'One', weight: 3 });
  });

  it('prefers the catalog field list over the content when one exists', async () => {
    const root = await createProject();
    await fs.writeFile(path.join(root, 'posts', 'one.md'), '---\ntitle: One\nstray: yes\n---\n');

    const loader = documentsLoader({
      dir: '.',
      root,
      defaultExtension: 'md',
      catalog: 'decap',
      collection: 'posts',
      z,
    });
    const { types } = await loader.createSchema!();

    // `stray` is in the file but not in config.yml. The declared contract wins.
    expect(types).toContain('title: string;');
    expect(types).not.toContain('stray');
  });
});
