import { init, parse } from 'es-module-lexer';
import MagicString from 'magic-string';
import { minimatch } from 'minimatch';

import { type LaikaRepositories, listKeys } from './backend.js';
import { type LaikaId, parseLaikaId, toSource } from './protocol.js';

/**
 * Rewrites `import.meta.glob('laika:…')` calls at transform time.
 *
 * Vite's native glob only understands filesystem paths, so a `laika:` pattern
 * would resolve to nothing. This runs as a `pre` transform: it lists the
 * repository for the keys each pattern matches and replaces the call with a
 * generated map — inlining static imports for `{ eager: true }` and dynamic
 * `() => import(...)` thunks otherwise, honouring `{ import: 'field' }` so a
 * blog index bundles only the fields it reads.
 */

interface ParsedGlob {
  /** Character index in the source where `import.meta.glob` begins. */
  start: number;
  /** Character index just past the closing `)`. */
  end: number;
  patterns: string[];
  eager: boolean;
  importName: string | undefined;
}

/**
 * Matches the `.glob(` that must follow an `import.meta` token for it to be an
 * `import.meta.glob(...)` call. Anchored at the end of the `import.meta` token
 * reported by the lexer, it tolerates whitespace around the member access and
 * captures up to (and including) the opening `(`.
 *
 * The optional `<…>` group is the TypeScript type argument — this transform
 * runs `pre`, so a `.ts` module still has `import.meta.glob<Posts>(…)` in its
 * source. Missing it would leave the pattern for Vite's native glob plugin,
 * which rejects a `laika:` specifier.
 */
const GLOB_ACCESS = /^\s*\.\s*glob\s*(?:<[^()]*>\s*)?\(/;

/** Find the index of the `)` that closes the `(` at `openIndex`, respecting strings and nesting. */
function findMatchingParen(code: string, openIndex: number): number {
  let depth = 0;
  let quote: string | undefined;
  for (let i = openIndex; i < code.length; i++) {
    const ch = code[i]!;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0 && ch === ')') return i;
    }
  }
  return -1;
}

/** Split `src` into top-level comma-separated argument slices. */
function splitTopLevelArgs(src: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let current = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quote) {
      current += ch;
      if (ch === '\\') {
        current += src[i + 1] ?? '';
        i++;
      } else if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      current += ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      current += ch;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      args.push(current);
      current = '';
    } else current += ch;
  }
  if (current.trim()) args.push(current);
  return args;
}

/** Pull every plain string-literal value out of a source slice. */
function extractStringLiterals(src: string): string[] {
  const literals: string[] = [];
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`([^`$\\]*)`/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src)) !== null) {
    const raw = match[1] ?? match[2] ?? match[3] ?? '';
    literals.push(raw.replace(/\\(['"`\\])/g, '$1'));
  }
  return literals;
}

/**
 * Blank out the contents of line comments, block comments and single/double
 * quoted strings, replacing each character with a space (newlines kept, so
 * offsets and line numbers are preserved). Used only by the fallback token
 * scanner: masking these regions is what stops a `laika:` glob that merely
 * appears inside a string or comment from being mistaken for a real call.
 *
 * Template literals are left as-is — a real `import.meta.glob(...)` call is
 * never spelled inside a quoted string, so blanking them would risk hiding a
 * genuine call sitting in a `${…}` expression while buying nothing.
 */
function maskStringsAndComments(code: string): string {
  const out = code.split('');
  const n = code.length;
  const blank = (from: number, to: number): void => {
    for (let j = from; j < to && j < n; j++) {
      if (out[j] !== '\n' && out[j] !== '\r') out[j] = ' ';
    }
  };
  let i = 0;
  while (i < n) {
    const ch = code[i]!;
    const next = code[i + 1];
    if (ch === '/' && next === '/') {
      let j = i + 2;
      while (j < n && code[j] !== '\n') j++;
      blank(i, j);
      i = j;
    } else if (ch === '/' && next === '*') {
      let j = i + 2;
      while (j < n && !(code[j] === '*' && code[j + 1] === '/')) j++;
      j = Math.min(n, j + 2);
      blank(i, j);
      i = j;
    } else if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < n && code[j] !== ch) {
        if (code[j] === '\\') j++;
        j++;
      }
      j = Math.min(n, j + 1);
      blank(i, j);
      i = j;
    } else {
      i++;
    }
  }
  return out.join('');
}

/** The `[start, end)` bounds of one `import.meta` token in the source. */
interface ImportMetaToken {
  start: number;
  end: number;
}

/**
 * Locate every real `import.meta` token, returning the same `[s, e)` bounds
 * es-module-lexer reports for a `d === -2` entry.
 *
 * The lexer is exact and fast, but it cannot parse JSX, so it throws on a
 * `.tsx`/`.jsx` module (a component that reaches for a `laika:` glob). When it
 * does, fall back to scanning a copy of the source with strings and comments
 * masked out, which is enough to locate `import.meta` tokens outside those
 * regions without a full parse.
 */
function importMetaTokens(code: string): ImportMetaToken[] {
  try {
    const [imports] = parse(code);
    return imports.filter(entry => entry.d === -2).map(entry => ({ start: entry.s, end: entry.e }));
  } catch {
    const masked = maskStringsAndComments(code);
    const tokens: ImportMetaToken[] = [];
    const re = /\bimport\s*\.\s*meta\b/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(masked)) !== null) {
      tokens.push({ start: match.index, end: match.index + match[0].length });
    }
    return tokens;
  }
}

/**
 * Locate and parse every `import.meta.glob(...)` call whose patterns use the
 * `laika:` protocol.
 *
 * `import.meta` tokens are located by {@link importMetaEnds}, which uses
 * es-module-lexer where it can and a string/comment-masked scan where it can't.
 * A balanced-paren scan, anchored on those positions, then extracts and parses
 * each call's arguments — so a `laika:` string that merely appears inside quotes
 * or a comment is never rewritten.
 */
function parseLaikaGlobs(code: string): ParsedGlob[] {
  const globs: ParsedGlob[] = [];
  for (const token of importMetaTokens(code)) {
    const access = GLOB_ACCESS.exec(code.slice(token.end));
    if (!access) continue;

    const open = token.end + access[0].length - 1;
    const close = findMatchingParen(code, open);
    if (close === -1) continue;

    const argsSrc = code.slice(open + 1, close);
    if (!argsSrc.includes('laika:')) continue;

    const args = splitTopLevelArgs(argsSrc);
    const patterns = extractStringLiterals(args[0] ?? '');
    if (patterns.length === 0 || !patterns.some(p => p.startsWith('laika:') || p.startsWith('!laika:'))) {
      continue;
    }
    const optionsSrc = args[1] ?? '';
    const eager = /\beager\s*:\s*true\b/.test(optionsSrc);
    const importMatch = optionsSrc.match(/\bimport\s*:\s*['"]([^'"]+)['"]/);
    globs.push({
      start: token.start,
      end: close + 1,
      patterns,
      eager,
      importName: importMatch?.[1],
    });
  }
  return globs;
}

/** Derive the listing folder and depth from a glob key like `posts/*` or `blog/**`. */
function folderAndDepth(globKey: string): { folder: string, depth: number } {
  const firstWildcard = globKey.search(/[*?[{]/);
  const prefix = firstWildcard === -1 ? globKey : globKey.slice(0, firstWildcard);
  const lastSlash = prefix.lastIndexOf('/');
  const folder = lastSlash === -1 ? '' : prefix.slice(0, lastSlash);
  if (globKey.includes('**')) return { folder, depth: 64 };
  const patternSlashes = (globKey.match(/\//g) ?? []).length;
  const folderSlashes = folder ? (folder.match(/\//g) ?? []).length + 1 : 0;
  return { folder, depth: Math.max(1, patternSlashes - folderSlashes + 1) };
}

/** Resolve all `laika:` ids a set of include/exclude patterns matches, deduped and sorted. */
async function resolveMatches(repos: LaikaRepositories, patterns: string[]): Promise<LaikaId[]> {
  const includes = patterns.filter(p => !p.startsWith('!'));
  const excludes = patterns.filter(p => p.startsWith('!')).map(p => p.slice(1));

  const byKey = new Map<string, LaikaId>();
  for (const pattern of includes) {
    const { namespace, key: globKey } = parseLaikaId(pattern);
    const { folder, depth } = folderAndDepth(globKey);
    const keys = await listKeys(repos, namespace, folder, depth);
    for (const key of keys) {
      if (!minimatch(key, globKey)) continue;
      const excluded = excludes.some(ex => {
        const parsed = parseLaikaId(ex);
        return parsed.namespace === namespace && minimatch(key, parsed.key);
      });
      if (excluded) continue;
      const id: LaikaId = { namespace, key };
      byKey.set(toSource(id), id);
    }
  }
  return [...byKey.values()].sort((a, b) => toSource(a).localeCompare(toSource(b)));
}

/** State threaded across all glob rewrites in one module so generated identifiers stay unique. */
interface RewriteContext {
  repos: LaikaRepositories;
  counter: { value: number };
  imports: string[];
}

/** Build the replacement map expression for a single glob call. */
async function expandGlob(glob: ParsedGlob, ctx: RewriteContext): Promise<string> {
  const ids = await resolveMatches(ctx.repos, glob.patterns);
  const entries = ids.map(id => {
    const source = toSource(id);
    if (glob.eager) {
      const local = `__laikaGlob${ctx.counter.value++}`;
      if (glob.importName) {
        ctx.imports.push(`import { ${glob.importName} as ${local} } from ${JSON.stringify(source)};`);
      } else {
        ctx.imports.push(`import * as ${local} from ${JSON.stringify(source)};`);
      }
      return `${JSON.stringify(source)}: ${local}`;
    }
    const dynamic = glob.importName
      ? `() => import(${JSON.stringify(source)}).then(m => m[${JSON.stringify(glob.importName)}])`
      : `() => import(${JSON.stringify(source)})`;
    return `${JSON.stringify(source)}: ${dynamic}`;
  });
  return `{ ${entries.join(', ')} }`;
}

/** The rewritten source plus a sourcemap tracing it back to the original. */
export interface RewriteResult {
  code: string;
  map: ReturnType<MagicString['generateMap']>;
}

/**
 * Rewrite laika globs in `code`. Returns the transformed source and a
 * sourcemap, or `null` when there is nothing to rewrite (so the caller can skip
 * a no-op transform result).
 */
export async function rewriteLaikaGlobs(
  code: string,
  repos: LaikaRepositories,
): Promise<RewriteResult | null> {
  // es-module-lexer must be initialized before `parse` is called.
  await init;

  const globs = parseLaikaGlobs(code);
  if (globs.length === 0) return null;

  const ctx: RewriteContext = { repos, counter: { value: 0 }, imports: [] };
  const s = new MagicString(code);

  const replacements = await Promise.all(
    globs.map(async glob => ({ glob, expr: await expandGlob(glob, ctx) })),
  );
  // Ranges are non-overlapping, so overwrite order is irrelevant.
  for (const { glob, expr } of replacements) {
    s.overwrite(glob.start, glob.end, expr);
  }
  if (ctx.imports.length > 0) s.prepend(`${ctx.imports.join('\n')}\n`);

  return { code: s.toString(), map: s.generateMap({ hires: true }) };
}
