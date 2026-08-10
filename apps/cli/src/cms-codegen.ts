/**
 * Codegen for a starter's `src/cms.ts` — the single CMS registration module.
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
 */

export interface CmsSelection {
  /** Registered backend names (the `backend.name` values a config may use). */
  backends: readonly string[];
  /** Widget names as used in collection `fields[].widget`. */
  widgets: readonly string[];
  /**
   * Entry-file codecs (`markdown`, `yaml`, `toml`, `json`). Git-style
   * backends read raw files and need one per stored format; the laika
   * backend serves entries as JSON and needs none.
   */
  codecs: readonly string[];
  /** Extra UI locales to register. `en` is built into the core app. */
  locales: readonly string[];
}

interface BackendSpec {
  /** The name the backend is registered under (what `backend.name` must be). */
  name: string;
  /** Subpath under `@laikacms/decap-cms/backends/`. */
  subpath: string;
  importLine: string;
  registerLine: string;
  description: string;
}

const backend = (
  name: string,
  subpath: string,
  className: string,
  description: string,
): BackendSpec => ({
  name,
  subpath,
  importLine: `import { ${className} } from '@laikacms/decap-cms/backends/${subpath}';`,
  registerLine: `CMS.registerBackend('${name}', ${className});`,
  description,
});

export const CMS_BACKENDS: readonly BackendSpec[] = [
  {
    name: 'laika',
    subpath: 'laika',
    importLine: `import createLaikaBackend from '@laikacms/decap-cms/backends/laika';`,
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

interface WidgetSpec {
  /** The `fields[].widget` name(s) this selection provides. */
  name: string;
  importLines: readonly string[];
  registerLines: readonly string[];
  description: string;
}

const widget = (name: string, exportName: string, description: string): WidgetSpec => ({
  name,
  importLines: [`import ${exportName} from '@laikacms/decap-cms/widgets/${name}';`],
  registerLines: [`CMS.registerWidget(${exportName}.Widget());`],
  description,
});

export const CMS_WIDGETS: readonly WidgetSpec[] = [
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
      `import { markdownFormat } from '@laikacms/decap-cms/format-packs/markdown';`,
      `import { passthroughSerializer, Widget as RichtextWidget } from '@laikacms/decap-cms/widgets/richtext';`,
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
export const CMS_CODECS: readonly { name: string, description: string }[] = [
  {
    name: 'markdown',
    description: 'markdown body + frontmatter block (composes with the selected languages, default yaml)',
  },
  { name: 'yaml', description: 'whole-entry YAML files (and yaml frontmatter)' },
  { name: 'toml', description: 'whole-entry TOML files (and toml frontmatter)' },
  { name: 'json', description: 'whole-entry JSON files (and json frontmatter)' },
];

/** UI translations shipped by the fork. `en` is built in and never needs registering. */
export const CMS_LOCALES: readonly string[] = [
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
export const DEFAULT_CMS_SELECTION: CmsSelection = {
  backends: ['laika'],
  widgets: ['string', 'datetime', 'richtext'],
  codecs: [],
  locales: [],
};

const BASE_IMPORT_LINES = [
  `import { CMS, init } from '@laikacms/decap-cms/laika-app/bare';`,
  `import en from '@laikacms/decap-cms/locales/en';`,
] as const;

const validate = (kind: string, chosen: readonly string[], valid: readonly string[]): void => {
  const unknown = chosen.filter(name => !valid.includes(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown ${kind}: ${unknown.join(', ')}. Valid ${kind}: ${valid.join(', ')}`);
  }
};

/** Runtime package exports selected by the CMS wizard. */
export function selectedCmsExtensionSubpaths(selection: CmsSelection): string[] {
  validate('backends', selection.backends, CMS_BACKENDS.map(item => item.name));
  validate('widgets', selection.widgets, CMS_WIDGETS.map(item => item.name));
  const importLines = [
    ...CMS_BACKENDS.filter(item => selection.backends.includes(item.name)).map(item => item.importLine),
    ...CMS_WIDGETS.filter(item => selection.widgets.includes(item.name)).flatMap(item => item.importLines),
    ...selection.locales.map(locale => `import ${locale} from '@laikacms/decap-cms/locales/${locale}';`),
  ];
  const packagePrefix = '@laikacms/decap-cms/';
  return importLines.flatMap(line => {
    const specifier = /\bfrom\s+['"]([^'"]+)['"]/.exec(line)?.[1];
    return specifier?.startsWith(packagePrefix) ? [specifier.slice(packagePrefix.length)] : [];
  });
}

/**
 * Emit the content of `src/cms.ts` for a selection. Output order follows the
 * catalogs, not the selection, so the file is deterministic.
 */
export function generateCmsModule(selection: CmsSelection): string {
  validate('backends', selection.backends, CMS_BACKENDS.map(b => b.name));
  validate('widgets', selection.widgets, CMS_WIDGETS.map(w => w.name));
  validate('locales', selection.locales, CMS_LOCALES);
  if (selection.backends.length === 0) {
    throw new Error('Select at least one backend — the admin cannot start without one.');
  }

  const backends = CMS_BACKENDS.filter(b => selection.backends.includes(b.name));
  const widgets = CMS_WIDGETS.filter(w => selection.widgets.includes(w.name));
  const locales = CMS_LOCALES.filter(l => selection.locales.includes(l));

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
    ...locales.map(l => `import ${l} from '@laikacms/decap-cms/locales/${l}';`),
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
