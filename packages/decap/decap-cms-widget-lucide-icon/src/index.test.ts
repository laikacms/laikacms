/**
 * Smoke tests for decap-cms-widget-lucide-icon
 *
 * These tests validate the exported widget shape without rendering React
 * components. Browser-only dependencies (decap-cms-ui-default, @emotion/css)
 * are mocked so the tests run in a pure Node environment.
 */

import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Stub browser-only deps BEFORE any import that transitively loads them
// ---------------------------------------------------------------------------

vi.mock('decap-cms-ui-default', () => ({
  colors: { textFieldBorder: '#ccc', text: '#000', inputBackground: '#fff', active: '#00f', textLight: '#fff' },
  shadows: { inset: '' },
}));

vi.mock('@emotion/css', () => ({
  css: (x: any) => x,
}));

// ---------------------------------------------------------------------------
// Now import the module under test
// ---------------------------------------------------------------------------

import WidgetIcon from './index.js';

describe('WidgetIcon', () => {
  it('has correct name', () => {
    expect(WidgetIcon.name).toBe('icon');
  });

  it('has controlComponent', () => {
    expect(WidgetIcon.controlComponent).toBeDefined();
  });

  it('has previewComponent', () => {
    expect(WidgetIcon.previewComponent).toBeDefined();
  });

  it('Widget() returns widget config with correct name', () => {
    const w = WidgetIcon.Widget();
    expect(w.name).toBe('icon');
  });

  it('Widget() returns widget config with controlComponent', () => {
    const w = WidgetIcon.Widget();
    expect(w.controlComponent).toBeDefined();
  });

  it('Widget() returns widget config with previewComponent', () => {
    const w = WidgetIcon.Widget();
    expect(w.previewComponent).toBeDefined();
  });

  it('Widget() forwards custom options', () => {
    const customOpts = { schema: { properties: { value: { type: 'string' } } } };
    const w = WidgetIcon.Widget(customOpts as any);
    expect(w.name).toBe('icon');
    expect((w as any).schema).toBe(customOpts.schema);
  });

  it('controlComponent is a function (React component)', () => {
    expect(typeof WidgetIcon.controlComponent).toBe('function');
  });

  it('previewComponent is a function (React component)', () => {
    expect(typeof WidgetIcon.previewComponent).toBe('function');
  });
});
