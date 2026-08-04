/**
 * Shared identifier helpers for the `@laikacms/vite-plugin` virtual module
 * surface. Both the runtime module builder (module.ts) and the typegen renderer
 * must agree on which content keys can become named ESM exports, so the logic
 * lives here and is imported by both.
 *
 * A key is a "safe identifier" when it is a valid JavaScript/TypeScript
 * identifier AND is not a reserved word — only then can it be emitted as a
 * `export const <name>` / destructured binding without a syntax error.
 */

/**
 * Reserved words that cannot be used as a binding name in a module scope. This
 * covers ECMAScript reserved words, the strict-mode reserved words, `let`/
 * `const`-context future reserved words, and the module-context specials
 * (`await`, `enum`). `default` is included because `export const default` is
 * illegal even though `default` is otherwise a valid property name.
 */
export const RESERVED_WORDS: ReadonlySet<string> = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  // Strict-mode + module future-reserved words.
  'let',
  'static',
  'yield',
  'await',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
]);

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Returns `true` when `name` can be emitted verbatim as a named ESM export /
 * destructuring binding: a syntactically valid identifier that is not a
 * reserved word.
 */
export function isSafeIdentifier(name: string): boolean {
  if (name.length === 0) {
    return false;
  }
  if (!IDENTIFIER_PATTERN.test(name)) {
    return false;
  }
  return !RESERVED_WORDS.has(name);
}
