import { describe, expect, it } from 'vitest';

import { listMappers } from '@laikacloud/portabletext-core';
import { schema, Widget } from '../index';
import { ensureDefaultMappersRegistered } from '../widget/register-mappers';

describe('decap-cms-widget-portabletext-editor', () => {
  it('exports a Widget() factory returning the Decap descriptor shape', () => {
    const w = Widget();
    expect(w.name).toBe('portabletext-editor');
    expect(typeof w.controlComponent).toBe('function');
    expect(typeof w.previewComponent).toBe('function');
    expect(w.schema).toBe(schema);
  });

  it('registers every bundled mapper on side-effect import', () => {
    ensureDefaultMappersRegistered();
    const ids = listMappers().map(m => m.id);
    // Spot-check: a representative sample of each category.
    expect(ids).toContain('markdown');
    expect(ids).toContain('html');
    expect(ids).toContain('portabletext');
    expect(ids).toContain('jupyter');
    expect(ids).toContain('slack-blocks');
    expect(ids).toContain('adaptive-cards');
    expect(ids).toContain('fountain');
    expect(ids).toContain('typst');
    // Must register at least 68 (the format-mapper count).
    expect(ids.length).toBeGreaterThanOrEqual(68);
  });
});
