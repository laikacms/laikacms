import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFsStorage, createRepositories, readItem } from './backend.js';
import { rewriteLaikaGlobs } from './glob.js';
import { renderModule } from './module.js';
import { laikacms } from './plugin.js';
import { parseLaikaId, toVirtualId } from './protocol.js';

let tmpDir: string;

/** Write a JSON storage object to `content/<key>.json` under the temp root. */
async function writeObject(key: string, content: unknown): Promise<void> {
  const file = path.join(tmpDir, 'content', `${key}.json`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(content), 'utf8');
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-loader-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('renderModule', () => {
  it('emits a named export per top-level field plus a default', () => {
    const code = renderModule({
      content: { title: 'Hello', body: 'World' },
      meta: { key: 'posts/hello', language: 'en' },
    });
    expect(code).toMatch(/const __f0 = "Hello";/);
    expect(code).toMatch(/export const title = __f0;/);
    expect(code).toMatch(/export const body = __f1;/);
    expect(code).toContain('export const $key = "posts/hello";');
    expect(code).toContain('export default {');
  });

  it('exports non-identifier keys via arbitrary string names', () => {
    const code = renderModule({ content: { 'kebab-case': 1, 'class': 2 } });
    expect(code).toContain('as "kebab-case"');
    expect(code).toContain('as "class"');
  });

  it('keeps the compiled body out of the default export', () => {
    // `import data from 'laika:…'` must stay pure data — pulling the component
    // in would drag the MDX runtime into every consumer of the item.
    const code = renderModule({
      content: { title: 'Hello', body: 'Prose.' },
      meta: { key: 'platform' },
      mdxSpecifier: '/.laika/bodies/store/platform.mdx',
    });
    expect(code).toContain('export { default as Body } from "/.laika/bodies/store/platform.mdx";');
    expect(code).toMatch(/export default \{[^}]*"body"/);
    expect(code).not.toMatch(/export default \{[^}]*Body:/);
  });

  it('refuses to shadow a content field named Body', () => {
    expect(() =>
      renderModule({
        content: { Body: 'mine', body: 'Prose.' },
        meta: { key: 'platform' },
        mdxSpecifier: '/.laika/bodies/store/platform.mdx',
      })
    ).toThrow(/"Body" field/);
  });
});

describe('repositories', () => {
  it('reads a storage object as content + meta', async () => {
    await writeObject('posts/hello', { title: 'Hello', body: 'Body' });
    const repos = createRepositories(createFsStorage({ dir: path.join(tmpDir, 'content') }));
    const { content, meta } = await readItem(repos, parseLaikaId('laika:store/posts/hello'));
    expect(content).toMatchObject({ title: 'Hello', body: 'Body' });
    expect(meta['key']).toBe('posts/hello');
  });
});

describe('plugin hooks', () => {
  /**
   * Resolve the config too — `root` defaults to `process.cwd()`, so a plugin
   * that skips this step writes its generated output into the package itself.
   */
  const makePlugin = (options: Parameters<typeof laikacms>[0] = {}) => {
    const plugin = laikacms({ storage: createFsStorage({ dir: path.join(tmpDir, 'content') }), ...options });
    (plugin.configResolved as (c: { root: string, command: string }) => void)({
      root: tmpDir,
      command: 'build',
    });
    return plugin;
  };

  it('resolves laika: sources to a virtual id', () => {
    const plugin = makePlugin();
    const resolve = plugin.resolveId as (s: string) => string | null;
    expect(resolve('laika:doc/posts/hello')).toBe(toVirtualId({ namespace: 'doc', key: 'posts/hello' }));
  });

  it('rewrites globs for the dependency scanner, which skips user transforms', async () => {
    // Without this the scan aborts on the first laika: glob and dev silently
    // starts with dependency pre-bundling disabled.
    await writeObject('posts/a', { title: 'A' });
    const plugin = makePlugin();
    const config = plugin.config as () => {
      optimizeDeps: {
        rolldownOptions: {
          plugins: Array<{ transform: { handler: (c: string) => Promise<{ code: string } | null> } }>,
        },
      },
    };
    const scanPlugin = config().optimizeDeps.rolldownOptions.plugins[0]!;
    const out = await scanPlugin.transform.handler(
      `const posts = import.meta.glob('laika:store/posts/*');`,
    );
    expect(out?.code).toContain('() => import("laika:store/posts/a")');
  });

  it('loads a virtual id into a module with per-field exports', async () => {
    await writeObject('posts/hello', { title: 'Hello', body: 'Body' });
    const plugin = makePlugin();
    const load = plugin.load as (id: string) => Promise<{ code: string } | null>;
    const result = await load(toVirtualId({ namespace: 'store', key: 'posts/hello' }));
    expect(result?.code).toMatch(/const __f0 = "Hello";/);
    expect(result?.code).toMatch(/export const title = __f0;/);
  });

  it('leaves the body a plain string when mdx is off', async () => {
    await writeObject('posts/hello', { title: 'Hello', body: '# Prose' });
    const plugin = makePlugin();
    const load = plugin.load as (id: string) => Promise<{ code: string } | null>;
    const result = await load(toVirtualId({ namespace: 'store', key: 'posts/hello' }));
    expect(result?.code).not.toContain('Body');
    await expect(fs.access(path.join(tmpDir, '.laika', 'bodies'))).rejects.toThrow();
  });

  it('writes the body chunk before handing back the module that imports it', async () => {
    // Ordering is the point: the bundler resolves the import as soon as `load`
    // returns, so a chunk written any later is a missing file.
    await writeObject('pages/platform', { badge: 'Soon', body: 'Self-install `laika-gateway`.' });
    const plugin = makePlugin({ mdx: true });
    const load = plugin.load as (id: string) => Promise<{ code: string } | null>;
    const result = await load(toVirtualId({ namespace: 'store', key: 'pages/platform' }));

    const chunk = path.join(tmpDir, '.laika', 'bodies', 'store', 'pages', 'platform.mdx');
    expect(await fs.readFile(chunk, 'utf8')).toBe('Self-install `laika-gateway`.\n');
    expect(result?.code).toContain(
      'export { default as Body } from "/.laika/bodies/store/pages/platform.mdx";',
    );
    // The raw string stays exported too, for anything that wants the source.
    expect(result?.code).toMatch(/export const body = __f1;/);
  });
});

describe('rewriteLaikaGlobs', () => {
  it('expands an eager glob with a single field into a map', async () => {
    await writeObject('posts/a', { title: 'A', body: 'x' });
    await writeObject('posts/b', { title: 'B', body: 'y' });
    const repos = createRepositories(createFsStorage({ dir: path.join(tmpDir, 'content') }));
    const code = `const posts = import.meta.glob('laika:store/posts/*', { import: 'title', eager: true });`;
    const out = await rewriteLaikaGlobs(code, repos);
    expect(out).not.toBeNull();
    expect(out?.code).toContain('import { title as __laikaGlob0 } from "laika:store/posts/a"');
    expect(out?.code).toContain('import { title as __laikaGlob1 } from "laika:store/posts/b"');
    expect(out?.code).toContain('"laika:store/posts/a": __laikaGlob0');
  });

  it('expands a glob written with a TypeScript type argument', async () => {
    // The transform runs `pre`, so a .ts module still carries `<Post>` here.
    await writeObject('posts/a', { title: 'A' });
    const repos = createRepositories(createFsStorage({ dir: path.join(tmpDir, 'content') }));
    const out = await rewriteLaikaGlobs(
      `const posts = import.meta.glob<Record<string, Post>>('laika:store/posts/*', { eager: true });`,
      repos,
    );
    expect(out?.code).toContain('import * as __laikaGlob0 from "laika:store/posts/a"');
    expect(out?.code).not.toContain('import.meta.glob');
  });

  it('expands a lazy glob into dynamic import thunks', async () => {
    await writeObject('posts/a', { title: 'A' });
    const repos = createRepositories(createFsStorage({ dir: path.join(tmpDir, 'content') }));
    const out = await rewriteLaikaGlobs(`import.meta.glob('laika:store/posts/*')`, repos);
    expect(out?.code).toContain('() => import("laika:store/posts/a")');
  });

  it('returns a sourcemap for a rewritten module', async () => {
    await writeObject('posts/a', { title: 'A' });
    const repos = createRepositories(createFsStorage({ dir: path.join(tmpDir, 'content') }));
    const out = await rewriteLaikaGlobs(`import.meta.glob('laika:store/posts/*')`, repos);
    expect(out).not.toBeNull();
    expect(out?.map).toBeTruthy();
    expect(out?.map.mappings).toBeTypeOf('string');
    expect(out?.map.mappings.length).toBeGreaterThan(0);
  });

  it('leaves non-laika globs untouched', async () => {
    const repos = createRepositories(createFsStorage({ dir: path.join(tmpDir, 'content') }));
    expect(await rewriteLaikaGlobs(`import.meta.glob('./pages/*.js')`, repos)).toBeNull();
  });

  it('never rewrites a laika glob that only appears in a string or comment', async () => {
    await writeObject('posts/a', { title: 'A' });
    const repos = createRepositories(createFsStorage({ dir: path.join(tmpDir, 'content') }));
    const code = [
      `const s = "import.meta.glob('laika:store/posts/*')";`,
      `// import.meta.glob('laika:store/posts/*')`,
      `/* import.meta.glob('laika:store/posts/*') */`,
    ].join('\n');
    // No real call — the `laika:` occurrences live inside a string and comments.
    expect(await rewriteLaikaGlobs(code, repos)).toBeNull();
  });

  it('rewrites only the real call, leaving a string-literal occurrence intact', async () => {
    await writeObject('posts/a', { title: 'A' });
    const repos = createRepositories(createFsStorage({ dir: path.join(tmpDir, 'content') }));
    const code = [
      `const s = "import.meta.glob('laika:store/posts/*')";`,
      `const real = import.meta.glob('laika:store/posts/*');`,
    ].join('\n');
    const out = await rewriteLaikaGlobs(code, repos);
    expect(out).not.toBeNull();
    // The string literal is preserved verbatim, not expanded.
    expect(out?.code).toContain(`const s = "import.meta.glob('laika:store/posts/*')";`);
    // The real call is expanded to a thunk map.
    expect(out?.code).toContain('() => import("laika:store/posts/a")');
  });

  it('rewrites a glob in a module whose JSX es-module-lexer cannot parse', async () => {
    await writeObject('posts/a', { title: 'A' });
    const repos = createRepositories(createFsStorage({ dir: path.join(tmpDir, 'content') }));
    // The JSX (and `x < y` comparison) makes es-module-lexer throw; the fallback
    // scanner still finds the real call.
    const code = [
      `export function C({ x, y }) {`,
      `  return <div className="card">{x < y ? 'a' : 'b'}</div>;`,
      `}`,
      `const posts = import.meta.glob('laika:store/posts/*');`,
    ].join('\n');
    const out = await rewriteLaikaGlobs(code, repos);
    expect(out).not.toBeNull();
    expect(out?.code).not.toContain('import.meta.glob');
    expect(out?.code).toContain('() => import("laika:store/posts/a")');
    // The JSX is untouched.
    expect(out?.code).toContain(`<div className="card">`);
  });

  it('ignores string/comment occurrences even when the module contains JSX', async () => {
    await writeObject('posts/a', { title: 'A' });
    const repos = createRepositories(createFsStorage({ dir: path.join(tmpDir, 'content') }));
    // JSX forces the lexer fallback; masking must still keep these from rewriting.
    const code = [
      `export const El = () => <p>hello</p>;`,
      `const s = "import.meta.glob('laika:store/posts/*')";`,
      `// import.meta.glob('laika:store/posts/*')`,
    ].join('\n');
    expect(await rewriteLaikaGlobs(code, repos)).toBeNull();
  });
});

describe('vite build (end-to-end tree-shaking)', () => {
  it('inlines imported fields and shakes out unused ones', async () => {
    await writeObject('posts/hello', { title: 'Hello', body: 'BIG_BODY_MARKER' });
    await writeObject('posts/world', { title: 'World', body: 'ANOTHER_BODY_MARKER' });
    await fs.writeFile(
      path.join(tmpDir, 'entry.js'),
      [
        `import { title } from 'laika:store/posts/hello';`,
        `const titles = import.meta.glob('laika:store/posts/*', { import: 'title', eager: true });`,
        `export { title, titles };`,
      ].join('\n'),
      'utf8',
    );

    const { build } = await import('vite');
    const result = await build({
      root: tmpDir,
      logLevel: 'silent',
      plugins: [laikacms({ dir: 'content' })],
      build: {
        write: false,
        minify: false,
        lib: { entry: path.join(tmpDir, 'entry.js'), formats: ['es'], fileName: 'out' },
      },
    });

    const output = Array.isArray(result) ? result[0]! : result;
    const chunk = (output as { output: Array<{ type: string, code?: string }> }).output
      .find(o => o.type === 'chunk') as { code: string };

    expect(chunk.code).toContain('Hello');
    expect(chunk.code).toContain('World');
    // Bodies are never imported, so they must be shaken out of the bundle.
    expect(chunk.code).not.toContain('BIG_BODY_MARKER');
    expect(chunk.code).not.toContain('ANOTHER_BODY_MARKER');
  }, 60_000);
});

describe('vite build (end-to-end typegen)', () => {
  it('writes compiler-inferred declarations during the build lifecycle', async () => {
    await writeObject('posts/hello', { title: 'Hello', tags: ['a', 'b'], draft: false });
    await fs.writeFile(
      path.join(tmpDir, 'entry.js'),
      `import { title } from 'laika:store/posts/hello';\nexport { title };\n`,
      'utf8',
    );

    const { build } = await import('vite');
    await build({
      root: tmpDir,
      logLevel: 'silent',
      plugins: [laikacms({ dir: 'content' })],
      build: {
        write: false,
        minify: false,
        lib: { entry: path.join(tmpDir, 'entry.js'), formats: ['es'], fileName: 'out' },
      },
    });

    // buildStart → regenerateAll wrote the declaration file, and the TS compiler
    // (not us) inferred the field types from the real data.
    const dts = await fs.readFile(path.join(tmpDir, '.laika', 'types.d.ts'), 'utf8');
    expect(dts).toContain(`declare module 'laika:store/posts/hello'`);
    expect(dts).toMatch(/title:\s*string/);
    expect(dts).toMatch(/tags:\s*(string\[\]|Array<string>)/);
    expect(dts).toMatch(/draft:\s*boolean/);

    // The committed one-line reference file is scaffolded at the project root.
    const env = await fs.readFile(path.join(tmpDir, 'laika-env.d.ts'), 'utf8');
    expect(env).toContain('.laika/types.d.ts');
  }, 60_000);
});
