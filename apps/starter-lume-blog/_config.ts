/**
 * Lume configuration file.
 *
 * Lume reads files from `src/` and outputs to `_site/`.
 * Markdown files with YAML front-matter are supported out of the box.
 * Nunjucks templates (.njk) are used for layouts.
 *
 * LaikaCMS content directory is `src/posts/` — Decap CMS writes markdown
 * files here and Lume picks them up automatically (watch mode refreshes).
 *
 * See https://lume.land/docs/configuration/config-file/ for options.
 */
import lume from 'lume/mod.ts';
import nunjucks from 'lume/plugins/nunjucks.ts';

const site = lume({
  src: './src',
  dest: './_site',
  server: {
    port: 4000,
  },
});

site.use(nunjucks());

export default site;
