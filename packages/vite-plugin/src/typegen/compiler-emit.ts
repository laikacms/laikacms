/**
 * Turns a rendered value-bearing TypeScript module (see renderer.ts) into a
 * `declare module '<specifier>' { ... }` block by running the TypeScript
 * compiler API over it and capturing the emitted `.d.ts`. The COMPILER produces
 * the types, so the generated declarations can never drift from what tsc would
 * infer for the same runtime module.
 *
 * `typescript` is loaded lazily and treated as optional: if it cannot be
 * resolved (or emit fails), the caller gets `null` and falls back to the
 * generic ambient `laika:*` module so imports still compile.
 */

type TypeScriptApi = typeof import('typescript');

/** Loader indirection so tests can simulate `typescript` being unavailable. */
export type TypeScriptLoader = () => Promise<TypeScriptApi | null>;

/**
 * Default loader: dynamically import `typescript`, tolerating both the CJS
 * default-interop shape and a namespace shape. Never throws.
 */
export const loadTypeScript: TypeScriptLoader = async () => {
  try {
    const mod = (await import('typescript')) as unknown as { default?: TypeScriptApi } & TypeScriptApi;
    return mod.default ?? mod;
  } catch {
    return null;
  }
};

/** Turns a namespace + key into the virtual module specifier. */
function normalizeDeclarations(dts: string): string {
  return dts
    // Inside an ambient `declare module { }` block the members are already
    // ambient, so strip redundant `declare` (keeping any leading `export`).
    .replace(/^(\s*)export declare /gm, '$1export ')
    .replace(/^(\s*)declare /gm, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

function indent(body: string): string {
  return body
    .split('\n')
    .map(line => (line.length > 0 ? `  ${line}` : line))
    .join('\n');
}

/**
 * Wraps an emitted `.d.ts` body in an exact ambient module declaration for
 * `specifier`.
 */
export function wrapAmbientModule(specifier: string, dts: string): string {
  const body = indent(normalizeDeclarations(dts));
  return `declare module '${specifier}' {\n${body}\n}\n`;
}

/**
 * The generic, lowest-specificity fallback so that any `laika:*` import type-
 * checks even before its exact block has been generated (cold start), or when
 * `typescript` is unavailable. Exact `declare module 'laika:doc/…'` blocks win
 * over this wildcard.
 */
export function genericFallbackModule(): string {
  return [
    "declare module 'laika:*' {",
    '  const data: Record<string, unknown>;',
    '  export default data;',
    '  export const $key: string;',
    '}',
    '',
  ].join('\n');
}

/**
 * Emits the `.d.ts` text for a rendered module `source`, using an in-memory
 * source file layered over the default compiler host (so lib types like
 * `Array` resolve). Returns the raw emitted declaration text, or `null` when
 * `typescript` is unavailable / emit produced nothing.
 */
export async function emitDeclarations(
  source: string,
  loader: TypeScriptLoader = loadTypeScript,
): Promise<string | null> {
  const ts = await loader();
  if (!ts) {
    return null;
  }

  const fileName = 'laika-item.ts';
  const dtsName = 'laika-item.d.ts';
  const options: import('typescript').CompilerOptions = {
    declaration: true,
    emitDeclarationOnly: true,
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmitOnError: false,
  };

  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ESNext, true);
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const outputs: Record<string, string> = {};

  host.getSourceFile = (name, languageVersion, onError, shouldCreate) =>
    name === fileName ? sourceFile : originalGetSourceFile(name, languageVersion, onError, shouldCreate);
  host.writeFile = (name, text) => {
    outputs[name] = text;
  };
  const originalReadFile = host.readFile.bind(host);
  host.readFile = name => (name === fileName ? source : originalReadFile(name));
  const originalFileExists = host.fileExists.bind(host);
  host.fileExists = name => name === fileName || originalFileExists(name);

  const program = ts.createProgram([fileName], options, host);
  program.emit(sourceFile);

  const emitted = outputs[dtsName];
  return emitted && emitted.trim().length > 0 ? emitted : null;
}
