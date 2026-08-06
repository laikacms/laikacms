import { describe, expect, it } from 'vitest';

import {
  CMS_BACKENDS,
  CMS_LOCALES,
  CMS_WIDGETS,
  DEFAULT_CMS_SELECTION,
  generateCmsModule,
  selectedCmsExtensionSubpaths,
} from './cms-codegen.js';

describe('generateCmsModule', () => {
  it('generates the default selection against the bare, non-laika app', () => {
    const source = generateCmsModule(DEFAULT_CMS_SELECTION);
    expect(source).toContain(`import { DecapCmsApp as CMS, init } from '@laikacms/decap-cms/app/bare';`);
    expect(source).toContain(`import en from '@laikacms/decap-cms/locales/en';`);
    expect(source).toContain(`CMS.registerLocale('en', en);`);
    expect(source).toContain(`import createLaikaBackend from '@laikacms/decap-cms/backends/laika';`);
    expect(source).toContain(`CMS.registerBackend('laika', createLaikaBackend());`);
    expect(source).toContain(`CMS.registerWidget(DecapCmsWidgetString.Widget());`);
    expect(source).toContain(`CMS.registerWidget(DecapCmsWidgetDatetime.Widget());`);
    // richtext doubles as the `markdown` widget, with serializers and format pack
    expect(source).toContain(`CMS.registerWidget({ ...richtextWidget, name: 'markdown' });`);
    expect(source).toContain(`CMS.registerRichtextFormat(markdownFormat);`);
    expect(source).toContain(`export { CMS, init };`);
    // never the laika-styled app or the batteries-included classic bundle
    expect(source).not.toContain('laika-app');
    expect(source).not.toContain(`CMS.registerLocale('nl'`);
  });

  it('registers extra locales and non-default backends', () => {
    const source = generateCmsModule({
      backends: ['laika', 'github'],
      widgets: ['string'],
      locales: ['nl', 'zh_Hans'],
    });
    expect(source).toContain(`import { GitHubBackend } from '@laikacms/decap-cms/backends/github';`);
    expect(source).toContain(`CMS.registerBackend('github', GitHubBackend);`);
    expect(source).toContain(`import nl from '@laikacms/decap-cms/locales/nl';`);
    expect(source).toContain(`CMS.registerLocale('nl', nl);`);
    expect(source).toContain(`CMS.registerLocale('zh_Hans', zh_Hans);`);
  });

  it('is deterministic regardless of selection order', () => {
    const a = generateCmsModule({
      backends: ['github', 'laika'],
      widgets: ['datetime', 'string'],
      locales: ['nl', 'de'],
    });
    const b = generateCmsModule({
      backends: ['laika', 'github'],
      widgets: ['string', 'datetime'],
      locales: ['de', 'nl'],
    });
    expect(a).toBe(b);
  });

  it('rejects unknown names and an empty backend selection', () => {
    expect(() => generateCmsModule({ backends: ['laika'], widgets: ['does-not-exist'], locales: [] }))
      .toThrow(/Unknown widgets: does-not-exist/);
    expect(() => generateCmsModule({ backends: [], widgets: ['string'], locales: [] }))
      .toThrow(/at least one backend/);
    expect(() => generateCmsModule({ backends: ['laika'], widgets: ['string'], locales: ['en'] }))
      .toThrow(/Unknown locales: en/);
  });

  it('catalogs stay aligned with the fork subpaths this CLI pins', () => {
    expect(CMS_BACKENDS.map(b => b.name)).toContain('laika');
    expect(CMS_WIDGETS.map(w => w.name)).toContain('richtext');
    expect(CMS_LOCALES).not.toContain('en'); // Always registered as the fallback, not user-selectable.
  });

  it('returns package subpaths for selected runtime extensions', () => {
    expect(selectedCmsExtensionSubpaths({
      backends: ['github'],
      widgets: ['map', 'richtext'],
      codecs: [],
      locales: [],
    })).toEqual([
      'backends/github',
      'widgets/map',
      'format-packs/markdown',
      'widgets/richtext',
    ]);
  });
});
