/**
 * Must be the FIRST import of `src/cms.ts`. Prism's language components
 * (pulled in transitively by the richtext widget via `@lexical/code`) are
 * classic scripts extending a global `Prism`, while Prism core is CommonJS —
 * bundlers can hoist the components ahead of the core's require, crashing the
 * admin at load with `ReferenceError: Prism is not defined`.
 *
 * The full `@laikacms/decap-cms` composition roots run this bootstrap
 * themselves; the bare app (`app/bare`) leaves registration — and therefore
 * this ordering — to the host. Importing Prism core here, before any widget
 * import, guarantees the global exists first.
 */
import Prism from 'prismjs';

if (typeof window !== 'undefined' && !(window as { Prism?: unknown }).Prism) {
  (window as { Prism?: unknown }).Prism = Prism;
}
