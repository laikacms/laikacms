/**
 * Lume site configuration.
 *
 * Source: current directory (.) — Lume processes template files (.njk, .md)
 * Output: _site/ directory
 *
 * Integration notes:
 *   - content/posts/*.md   → written by Decap CMS (via admin sidecar), read by Lume
 *   - _includes/           → Lume layouts (not published to _site/)
 *   - server/,lib/         → admin sidecar and LaikaCMS lib (ignored by Lume)
 *
 * Lume uses the filesystem as-is; no laika.documents.* API calls are needed
 * during the build. Run `deno task admin:dev` separately to start the Decap
 * admin server that writes content files.
 */
import lume from 'lume/mod.ts';
import date from 'lume/plugins/date.ts';
import nunjucks from 'lume/plugins/nunjucks.ts';

const site = lume({
  location: new URL('http://localhost:3000'),
  src: '.',
  dest: '_site',
});

site.use(nunjucks());
site.use(date());

// Ignore non-site files so Lume does not try to render them as pages.
site.ignore(
  '_config.ts',
  'deno.json',
  'package.json',
  'README.md',
  'tsconfig.json',
  'lib',
  'server',
  'node_modules',
);

export default site;
