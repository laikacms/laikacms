import { describe, expect, it } from 'vitest';

import { decapAdapter } from './decap.js';
import { cmsAdapters, DEFAULT_CMS_ADAPTER, findCmsAdapter, getCmsAdapter } from './registry.js';
import type { CmsSelection } from './types.js';

const selection = (overrides: Partial<CmsSelection>): CmsSelection => ({
  adapter: 'decap',
  backends: ['laika'],
  widgets: [],
  codecs: [],
  locales: [],
  ...overrides,
});

describe('cms registry', () => {
  it('resolves adapters by name and defaults to the first one', () => {
    expect(DEFAULT_CMS_ADAPTER).toBe(decapAdapter);
    expect(getCmsAdapter('decap')).toBe(decapAdapter);
    expect(findCmsAdapter('nope')).toBeUndefined();
    expect(() => getCmsAdapter('nope')).toThrow(/Unknown CMS "nope"\. Available: decap/);
  });

  it('gives every adapter a default selection that names itself and generates', () => {
    for (const adapter of cmsAdapters) {
      expect(adapter.defaultSelection.adapter).toBe(adapter.name);
      expect(adapter.generateModule(adapter.defaultSelection)).not.toBe('');
    }
  });
});

describe('decapAdapter.generateModule', () => {
  it('generates the default selection against the bare, non-laika app', () => {
    const source = decapAdapter.generateModule(decapAdapter.defaultSelection);
    expect(source).toContain(`import { CMS, init } from '@laikacms/decap-cms/laika-app/bare';`);
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
    // never the laika-styled app (…/laika-app, no /bare) or the batteries-included
    // classic root bundle (…/decap-cms, no subpath) — only the bare entry is allowed
    expect(source).not.toContain(`/laika-app';`);
    expect(source).not.toContain(`decap-cms';`);
    expect(source).not.toContain(`CMS.registerLocale('nl'`);
  });

  it('registers extra locales and non-default backends', () => {
    const source = decapAdapter.generateModule(selection({
      backends: ['laika', 'github'],
      widgets: ['string'],
      locales: ['nl', 'zh_Hans'],
    }));
    expect(source).toContain(`import { GitHubBackend } from '@laikacms/decap-cms/backends/github';`);
    expect(source).toContain(`CMS.registerBackend('github', GitHubBackend);`);
    expect(source).toContain(`import nl from '@laikacms/decap-cms/locales/nl';`);
    expect(source).toContain(`CMS.registerLocale('nl', nl);`);
    expect(source).toContain(`CMS.registerLocale('zh_Hans', zh_Hans);`);
  });

  it('is deterministic regardless of selection order', () => {
    const a = decapAdapter.generateModule(selection({
      backends: ['github', 'laika'],
      widgets: ['datetime', 'string'],
      locales: ['nl', 'de'],
    }));
    const b = decapAdapter.generateModule(selection({
      backends: ['laika', 'github'],
      widgets: ['string', 'datetime'],
      locales: ['de', 'nl'],
    }));
    expect(a).toBe(b);
  });

  it('rejects unknown names and an empty backend selection', () => {
    expect(() => decapAdapter.generateModule(selection({ widgets: ['does-not-exist'] })))
      .toThrow(/Unknown widgets: does-not-exist/);
    expect(() => decapAdapter.generateModule(selection({ backends: [], widgets: ['string'] })))
      .toThrow(/at least one backend/);
    expect(() => decapAdapter.generateModule(selection({ widgets: ['string'], locales: ['en'] })))
      .toThrow(/Unknown locales: en/);
  });

  it('catalogs stay aligned with the fork subpaths this CLI pins', () => {
    expect(decapAdapter.backends.map(b => b.name)).toContain('laika');
    expect(decapAdapter.widgets.map(w => w.name)).toContain('richtext');
    expect(decapAdapter.locales).not.toContain('en'); // Always registered as the fallback, not user-selectable.
  });
});

describe('decapAdapter.extensionSubpaths', () => {
  it('returns package subpaths for selected runtime extensions', () => {
    expect(decapAdapter.extensionSubpaths(selection({
      backends: ['github'],
      widgets: ['map', 'richtext'],
    }))).toEqual([
      'backends/github',
      'widgets/map',
      'format-packs/markdown',
      'widgets/richtext',
    ]);
  });
});
