/**
 * The Decap CMS adapter — catalogs plus codegen for a starter's `src/cms.ts`,
 * the single CMS registration module.
 *
 * Every starter boots the bare, non-laika Decap app
 * (`@laikacms/decap-cms/laika-app/bare`), which registers nothing by itself — no
 * backends, widgets, entry codecs, or extra locales, and no auto-mount on
 * load. This module emits the `src/cms.ts` that registers exactly what the
 * user selected in the `laika create` wizard; the starter's admin entry
 * imports it and calls `init`.
 *
 * The catalogs below mirror the subpath exports of `@laikacms/decap-cms@4`.
 * `icon-picker` is intentionally absent: it is a support directory for the
 * lucide/radix icon widgets, not an importable widget itself.
 *
 * Everything Decap-shaped stays behind the {@link CmsAdapter} interface, so a
 * second admin UI is a sibling file plus one line in `./registry.ts`.
 */

import path from 'node:path';

import { discoverConfig, generateConfig } from './decap-config.js';
import type { CmsAdapter, CmsExtension, CmsSelection } from './types.js';

const PACKAGE_NAME = '@laikacms/decap-cms';
const ADAPTER_NAME = 'decap';

interface BackendSpec extends CmsExtension {
  /** Subpath under `@laikacms/decap-cms/backends/`. */
  subpath: string;
  importLine: string;
  registerLine: string;
}

const backend = (
  name: string,
  subpath: string,
  className: string,
  description: string,
): BackendSpec => ({
  name,
  subpath,
  importLine: `import { ${className} } from '${PACKAGE_NAME}/backends/${subpath}';`,
  registerLine: `CMS.registerBackend('${name}', ${className});`,
  description,
});

const BACKENDS: readonly BackendSpec[] = [
  {
    name: 'laika',
    subpath: 'laika',
    importLine: `import createLaikaBackend from '${PACKAGE_NAME}/backends/laika';`,
    registerLine: `CMS.registerBackend('laika', createLaikaBackend());`,
    description: 'LaikaCMS backend (decap-api proxy) — the default',
  },
  backend('github', 'github', 'GitHubBackend', 'GitHub repository storage'),
  backend('gitlab', 'gitlab', 'GitLabBackend', 'GitLab repository storage'),
  backend('gitea', 'gitea', 'GiteaBackend', 'Gitea repository storage'),
  backend('forgejo', 'forgejo', 'ForgejoBackend', 'Forgejo repository storage'),
  backend('bitbucket', 'bitbucket', 'BitbucketBackend', 'Bitbucket repository storage'),
  backend('azure', 'azure', 'AzureBackend', 'Azure DevOps repository storage'),
  backend('git-gateway', 'git-gateway', 'GitGatewayBackend', 'Netlify/Decap git-gateway'),
  backend(
    'aws-cognito-github-proxy',
    'aws-cognito-github-proxy',
    'AwsCognitoGitHubProxyBackend',
    'GitHub via an AWS Cognito proxy',
  ),
  backend('proxy', 'proxy', 'ProxyBackend', 'Local decap-server proxy (development)'),
  backend('test-repo', 'test', 'TestBackend', 'In-memory test backend (demos)'),
];

interface WidgetSpec extends CmsExtension {
  importLines: readonly string[];
  registerLines: readonly string[];
}

const widget = (name: string, exportName: string, description: string): WidgetSpec => ({
  name,
  importLines: [`import ${exportName} from '${PACKAGE_NAME}/widgets/${name}';`],
  registerLines: [`CMS.registerWidget(${exportName}.Widget());`],
  description,
});

const WIDGETS: readonly WidgetSpec[] = [
  widget('string', 'DecapCmsWidgetString', 'single-line text'),
  widget('text', 'DecapCmsWidgetText', 'multi-line plain text'),
  widget('boolean', 'DecapCmsWidgetBoolean', 'toggle'),
  widget('number', 'DecapCmsWidgetNumber', 'numeric input'),
  widget('datetime', 'DecapCmsWidgetDatetime', 'date/time picker'),
  widget('select', 'DecapCmsWidgetSelect', 'dropdown of options'),
  widget('object', 'DecapCmsWidgetObject', 'nested field group'),
  widget('list', 'DecapCmsWidgetList', 'repeatable entries'),
  widget('relation', 'DecapCmsWidgetRelation', 'reference to another entry'),
  widget('code', 'DecapCmsWidgetCode', 'code editor'),
  widget('file', 'DecapCmsWidgetFile', 'file upload'),
  widget('image', 'DecapCmsWidgetImage', 'image upload'),
  widget('map', 'DecapCmsWidgetMap', 'geographic point/geometry'),
  widget('colorstring', 'DecapCmsWidgetColorString', 'color picker'),
  widget('uuid', 'DecapCmsWidgetUuid', 'generated unique id'),
  widget('lucide-icon', 'DecapCmsWidgetLucideIcon', 'Lucide icon picker'),
  widget('radix-icon', 'DecapCmsWidgetRadixIcon', 'Radix icon picker'),
  widget('aichat', 'DecapCmsWidgetAiChat', 'AI chat assistant'),
  {
    name: 'richtext',
    importLines: [
      `import { markdownFormat } from '${PACKAGE_NAME}/format-packs/markdown';`,
      `import { passthroughSerializer, Widget as RichtextWidget } from '${PACKAGE_NAME}/widgets/richtext';`,
    ],
    registerLines: [
      `// Spread: interfaces lack the implicit index signature registerWidget expects`,
      `const richtextWidget = { ...RichtextWidget() };`,
      `CMS.registerWidget(richtextWidget);`,
      `CMS.registerWidget({ ...richtextWidget, name: 'markdown' });`,
      `CMS.registerWidgetValueSerializer('richtext', passthroughSerializer);`,
      `CMS.registerWidgetValueSerializer('markdown', passthroughSerializer);`,
      `CMS.registerRichtextFormat(markdownFormat);`,
    ],
    description: 'rich text editor (also registered as `markdown`)',
  },
];

/** Frontmatter-capable entry-codec languages; `markdown` composes with them. */
const CODECS: readonly CmsExtension[] = [
  {
    name: 'markdown',
    description: 'markdown body + frontmatter block (composes with the selected languages, default yaml)',
  },
  { name: 'yaml', description: 'whole-entry YAML files (and yaml frontmatter)' },
  { name: 'toml', description: 'whole-entry TOML files (and toml frontmatter)' },
  { name: 'json', description: 'whole-entry JSON files (and json frontmatter)' },
];

/** UI translations shipped by the fork. `en` is built in and never needs registering. */
const LOCALES: readonly string[] = [
  'bg',
  'ca',
  'cs',
  'da',
  'de',
  'es',
  'fa',
  'fr',
  'gr',
  'he',
  'hr',
  'hu',
  'it',
  'ja',
  'ko',
  'lt',
  'mk',
  'nb_no',
  'nl',
  'nn_no',
  'pl',
  'pt',
  'ro',
  'ru',
  'sk',
  'sl',
  'sr_Cyrl',
  'sv',
  'th',
  'tr',
  'ua',
  'uk',
  'vi',
  'zh_Hans',
  'zh_Hant',
];

/**
 * What a starter needs when the user skips the wizard: the blog collections'
 * widgets on the laika backend — which stores entries as JSON, so no codecs.
 */
const DEFAULT_SELECTION: CmsSelection = {
  adapter: ADAPTER_NAME,
  backends: ['laika'],
  widgets: ['string', 'datetime', 'richtext'],
  codecs: [],
  locales: [],
};

const BASE_IMPORT_LINES = [
  `import { CMS, init } from '${PACKAGE_NAME}/laika-app/bare';`,
  `import en from '${PACKAGE_NAME}/locales/en';`,
] as const;

const validate = (kind: string, chosen: readonly string[], valid: readonly string[]): void => {
  const unknown = chosen.filter(name => !valid.includes(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown ${kind}: ${unknown.join(', ')}. Valid ${kind}: ${valid.join(', ')}`);
  }
};

/** Runtime package exports selected by the CMS wizard. */
function extensionSubpaths(selection: CmsSelection): string[] {
  validate('backends', selection.backends, BACKENDS.map(item => item.name));
  validate('widgets', selection.widgets, WIDGETS.map(item => item.name));
  const importLines = [
    ...BACKENDS.filter(item => selection.backends.includes(item.name)).map(item => item.importLine),
    ...WIDGETS.filter(item => selection.widgets.includes(item.name)).flatMap(item => item.importLines),
    ...selection.locales.map(locale => `import ${locale} from '${PACKAGE_NAME}/locales/${locale}';`),
  ];
  const packagePrefix = `${PACKAGE_NAME}/`;
  return importLines.flatMap(line => {
    const specifier = /\bfrom\s+['"]([^'"]+)['"]/.exec(line)?.[1];
    return specifier?.startsWith(packagePrefix) ? [specifier.slice(packagePrefix.length)] : [];
  });
}

/**
 * Emit the content of `src/cms.ts` for a selection. Output order follows the
 * catalogs, not the selection, so the file is deterministic.
 */
function generateModule(selection: CmsSelection): string {
  validate('backends', selection.backends, BACKENDS.map(b => b.name));
  validate('widgets', selection.widgets, WIDGETS.map(w => w.name));
  validate('locales', selection.locales, LOCALES);
  if (selection.backends.length === 0) {
    throw new Error('Select at least one backend — the admin cannot start without one.');
  }

  const backends = BACKENDS.filter(b => selection.backends.includes(b.name));
  const widgets = WIDGETS.filter(w => selection.widgets.includes(w.name));
  const locales = LOCALES.filter(l => selection.locales.includes(l));

  const lines: string[] = [
    '/**',
    ' * CMS registration module — generated by the `laika create` wizard.',
    ' *',
    ' * Boots the bare, non-laika Decap app (`@laikacms/decap-cms/laika-app/bare`), which',
    ' * ships with no backends, widgets, or locales; everything the admin',
    ' * uses is registered explicitly below. Re-run the wizard or edit this file',
    ' * to change the selection. English is always registered as the fallback.',
    ' */',
    ...BASE_IMPORT_LINES,
    '',
    ...backends.map(b => b.importLine),
    ...widgets.flatMap(w => w.importLines),
    ...locales.map(l => `import ${l} from '${PACKAGE_NAME}/locales/${l}';`),
    '',
    `CMS.registerLocale('en', en);`,
    '',
    ...backends.map(b => b.registerLine),
    '',
    ...widgets.flatMap(w => w.registerLines),
  ];
  if (locales.length > 0) {
    lines.push('', ...locales.map(l => `CMS.registerLocale('${l}', ${l});`));
  }
  lines.push('', 'export { CMS, init };', '');
  return lines.join('\n');
}

export const decapAdapter: CmsAdapter = {
  name: ADAPTER_NAME,
  title: 'Decap CMS',
  description: 'The LaikaCMS fork of Decap CMS',
  packageName: PACKAGE_NAME,
  backends: BACKENDS,
  widgets: WIDGETS,
  codecs: CODECS,
  locales: LOCALES,
  defaultSelection: DEFAULT_SELECTION,
  extensionSubpaths,
  generateModule,
  config: {
    discover: discoverConfig,
    defaultOutput: input => path.join(path.dirname(input), 'config.gen.ts'),
    generate: generateConfig,
  },
};
