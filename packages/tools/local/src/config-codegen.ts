import fs from 'node:fs/promises';
import path from 'node:path';

import yaml from 'js-yaml';

const DISCOVERY_CANDIDATES = [
  'config.yml',
  'config.yaml',
  path.join('src', 'config.yml'),
  path.join('src', 'config.yaml'),
] as const;

export interface DiscoverResult {
  readonly resolved: string;
  readonly searched: ReadonlyArray<string>;
}

/**
 * Search for a Decap CMS `config.yml`/`config.yaml`, starting in `cwd` and
 * falling through to `src/`. Returns the absolute path of the first match
 * together with every path that was checked, so callers can surface the
 * full list in a "not found" error.
 */
export async function discoverConfig(cwd: string): Promise<DiscoverResult> {
  const searched = DISCOVERY_CANDIDATES.map(rel => path.resolve(cwd, rel));
  for (const candidate of searched) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return { resolved: candidate, searched };
    } catch {
      // try next
    }
  }
  return { resolved: '', searched };
}

export async function loadConfig(inputPath: string): Promise<unknown> {
  const raw = await fs.readFile(inputPath, 'utf-8');
  // JSON_SCHEMA keeps the parsed value strictly JSON-shaped — no Date from
  // !!timestamp, no NaN/Infinity from .nan/.inf, no Symbol — so JSON.stringify
  // round-trips it faithfully. Decap reads YAML as JSON-shaped data at
  // runtime, so this matches its semantics.
  return yaml.load(raw, { schema: yaml.JSON_SCHEMA });
}

export interface SerializeOptions {
  /** Source path written into the header comment so readers know what to edit. */
  readonly sourcePath: string;
}

/**
 * PascalCase-ify a collection name for the emitted type identifier:
 *   "invoices"      → "Invoices"
 *   "ezaa-quotes"   → "EzaaQuotes"
 *   "blog_posts"    → "BlogPosts"
 * Strips characters that aren't valid in TS identifiers. Falls back to
 * `Collection<N>` if the name produces an empty result (e.g. all symbols).
 */
function pascalCase(name: string, fallback: string): string {
  const parts = name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  return parts.length > 0 ? parts.join('') : fallback;
}

/**
 * The literal TypeScript that drives per-collection entry types. Emitted
 * inline at the bottom of every generated file so consumers can `import {
 * type InvoicesEntry, type Entry, ... }` straight from the generated module
 * without any extra plumbing.
 *
 * The widget catalogue here matches Decap CMS's built-ins. Anything unknown
 * defaults to `string` — the YAML stores it as text either way.
 */
const HELPER_TYPES = `
// ─── Helper types — derived per-collection entry shapes ──────────────────────
//
// 'Config' is the inferred literal type of the default export. The two utility
// types below walk a collection's 'fields' tuple and produce a strict
// '{ name: type }' shape for each entry.

type Config = typeof config;
type Collection = Config['collections'][number];
type CollectionByName<N extends string> = Extract<Collection, { name: N }>;

type UnionToIntersection<U> =
  (U extends unknown ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;

type WidgetType<W extends string> =
  W extends 'number' ? number
  : W extends 'boolean' ? boolean
  : W extends 'date' | 'datetime' ? string
  : W extends 'string' | 'text' | 'markdown' | 'image' | 'file' | 'hidden' ? string
  : W extends 'auto-number' | 'auto-reference' | 'auto-date' ? string
  : W extends 'select' ? string
  : string;

type FieldToEntry<F> =
  F extends { name: infer N extends string; widget: 'object'; fields: infer Sub extends readonly unknown[] }
    ? { [K in N]: FieldsToEntry<Sub> }
  : F extends { name: infer N extends string; widget: 'list'; fields: infer Sub extends readonly unknown[] }
    ? { [K in N]?: ReadonlyArray<FieldsToEntry<Sub>> }
  : F extends { name: infer N extends string; widget: infer W extends string; required: false }
    ? { [K in N]?: WidgetType<W> }
  : F extends { name: infer N extends string; widget: infer W extends string }
    ? { [K in N]: WidgetType<W> }
  : Record<string, never>;

export type FieldsToEntry<Fs extends readonly unknown[]> =
  UnionToIntersection<{ [I in keyof Fs]: FieldToEntry<Fs[I]> }[number]>;
`;

interface DecapCollection {
  readonly name?: unknown;
}

interface DecapConfig {
  readonly collections?: ReadonlyArray<DecapCollection>;
}

function emitCollectionTypes(config: DecapConfig): string {
  const collections = Array.isArray(config.collections) ? config.collections : [];
  const entries: Array<{ raw: string; typeName: string }> = [];
  for (let i = 0; i < collections.length; i++) {
    const c = collections[i] as DecapCollection;
    if (typeof c.name !== 'string') continue;
    entries.push({ raw: c.name, typeName: `${pascalCase(c.name, `Collection${i}`)}Entry` });
  }
  if (entries.length === 0) return '';

  const perCollection = entries
    .map(
      ({ raw, typeName }) =>
        `export type ${typeName} = FieldsToEntry<CollectionByName<'${raw}'>['fields']>;`,
    )
    .join('\n');
  const union = `export type Entry = ${entries.map((e) => e.typeName).join(' | ')};`;
  return `\n${perCollection}\n\n${union}\n`;
}

export function serialize(obj: unknown, options: SerializeOptions): string {
  const header = [
    '// @generated',
    `// AUTO-GENERATED by @laikacms/local — do not edit by hand.`,
    `// Source: ${options.sourcePath}`,
    `// Regenerate via \`laika-local generate\`.`,
    '',
    '/* eslint-disable */',
    '// prettier-ignore',
    '// dprint-ignore-file',
    '// biome-ignore-all lint: generated file',
    '/* tslint:disable */',
    '',
  ].join('\n');
  const body = JSON.stringify(obj, null, 4);
  const collectionTypes = emitCollectionTypes(obj as DecapConfig);
  // Bind the literal to a `config` const so `typeof config` works inside the
  // helper-types block below; the default export still hands out the same
  // value, so consumers can `import config from '…'` exactly as before.
  return (
    `${header}` +
    `const config = ${body} as const;\n` +
    `export default config;\n` +
    `${HELPER_TYPES}` +
    `${collectionTypes}`
  );
}

export async function writeGenerated(
  outputPath: string,
  obj: unknown,
  options: SerializeOptions,
): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, serialize(obj, options), 'utf-8');
}

/**
 * One-shot pipeline: read input → write output. Returns the resolved
 * absolute input and output paths.
 */
export async function generateConfig(args: {
  readonly input: string;
  readonly output: string;
}): Promise<{ readonly input: string; readonly output: string }> {
  const absInput = path.resolve(args.input);
  const absOutput = path.resolve(args.output);
  const obj = await loadConfig(absInput);
  // Source path in the header is relative to the output file so the link
  // survives moving the pair around.
  const relSource = path.relative(path.dirname(absOutput), absInput);
  await writeGenerated(absOutput, obj, { sourcePath: relSource });
  return { input: absInput, output: absOutput };
}
