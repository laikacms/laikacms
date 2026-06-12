/**
 * Tests for decapAdminHtml() — covers the two bugs from LCMS-086:
 *   1. Missing window.CMS_MANUAL_INIT = true → Decap auto-fetches /config.yml → 404
 *   2. esm.sh CDN imports for unpublished packages → 404 → CMS.registerBackend never runs
 */

import { describe, expect, it } from 'vitest';

import { decapAdminHtml, DEFAULT_DEV_TOKEN } from './index.js';

describe('decapAdminHtml', () => {
  it('sets window.CMS_MANUAL_INIT = true before decap-cms.js script tag', () => {
    const html = decapAdminHtml();
    const manualInitPos = html.indexOf('window.CMS_MANUAL_INIT = true');
    const decapScriptPos = html.indexOf('decap-cms.js');
    expect(manualInitPos, 'CMS_MANUAL_INIT must be present').toBeGreaterThanOrEqual(0);
    expect(decapScriptPos, 'decap-cms.js script tag must be present').toBeGreaterThanOrEqual(0);
    expect(manualInitPos, 'CMS_MANUAL_INIT must appear before decap-cms.js').toBeLessThan(decapScriptPos);
  });

  it('sets load_config_file: false in the inlined config', () => {
    const html = decapAdminHtml();
    expect(html).toContain('"load_config_file": false');
  });

  it('contains no esm.sh imports', () => {
    const html = decapAdminHtml();
    expect(html).not.toContain('esm.sh');
  });

  it('does not import laikaBackendUrl/embeddedBundleUrl from CDN at all', () => {
    const html = decapAdminHtml();
    // No dynamic ESM import() or import statement from any CDN for the backend
    expect(html).not.toMatch(/import\s*\{[^}]*createLaikaBackend/);
    expect(html).not.toMatch(/import\s*\{[^}]*DEFAULT_DEV_TOKEN/);
  });

  it('inlines CMS.registerBackend call', () => {
    const html = decapAdminHtml();
    expect(html).toContain("CMS.registerBackend('laika'");
  });

  it('inlines CMS.init call with the provided config', () => {
    const config = { backend: { name: 'laika' }, collections: [] };
    const html = decapAdminHtml({ decapConfig: config });
    expect(html).toContain('CMS.init(');
    expect(html).toContain('"collections"');
  });

  it('uses DEFAULT_DEV_TOKEN when no devToken is provided', () => {
    const html = decapAdminHtml();
    expect(html).toContain(JSON.stringify(DEFAULT_DEV_TOKEN));
  });

  it('uses the provided devToken directly', () => {
    const html = decapAdminHtml({ devToken: 'my-secret-token' });
    expect(html).toContain('"my-secret-token"');
    // Should NOT contain the default token
    expect(html).not.toContain(JSON.stringify(DEFAULT_DEV_TOKEN));
  });

  it('loads decap-cms.js from unpkg by default', () => {
    const html = decapAdminHtml();
    expect(html).toContain('unpkg.com/decap-cms');
  });

  it('respects a custom decapBundleUrl', () => {
    const html = decapAdminHtml({ decapBundleUrl: 'https://example.com/decap.js' });
    expect(html).toContain('https://example.com/decap.js');
    expect(html).not.toContain('unpkg.com');
  });

  it('inlines the baseUrl expression using window.location.origin by default', () => {
    const html = decapAdminHtml();
    expect(html).toContain('window.location.origin');
  });

  it('uses a pinned baseUrl when provided', () => {
    const html = decapAdminHtml({ baseUrl: 'https://my-app.example.com' });
    expect(html).toContain('"https://my-app.example.com"');
    expect(html).not.toContain('window.location.origin');
  });

  it('produces valid HTML with a DOCTYPE', () => {
    const html = decapAdminHtml();
    expect(html.trim()).toMatch(/^<!DOCTYPE html>/i);
  });

  it('escapes HTML special chars in title', () => {
    const html = decapAdminHtml({ title: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  describe('adminBundleUrl option', () => {
    it('uses <script src> for the bundle instead of inline backend', () => {
      const html = decapAdminHtml({ adminBundleUrl: '/admin/bundle.js' });
      expect(html).toContain('src="/admin/bundle.js"');
    });

    it('still sets CMS_MANUAL_INIT before the decap script', () => {
      const html = decapAdminHtml({ adminBundleUrl: '/admin/bundle.js' });
      const manualInitPos = html.indexOf('window.CMS_MANUAL_INIT = true');
      const decapScriptPos = html.indexOf('decap-cms.js');
      expect(manualInitPos).toBeGreaterThanOrEqual(0);
      expect(manualInitPos).toBeLessThan(decapScriptPos);
    });

    it('does not include the inline backend when adminBundleUrl is set', () => {
      const html = decapAdminHtml({ adminBundleUrl: '/admin/bundle.js' });
      expect(html).not.toContain('createLaikaBackend');
    });
  });
});
