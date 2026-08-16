import { describe, expect, it } from 'vitest';

import en from './en.js';
import nl from './nl.js';

describe('server i18n bundles', () => {
  it('nl bundle is structurally identical to en (same keys)', () => {
    const enKeys = Object.keys(en).sort();
    const nlKeys = Object.keys(nl).sort();
    expect(nlKeys).toEqual(enKeys);
  });

  it('nl bundle is not a copy of en (translated)', () => {
    expect(nl.systemPrompt).not.toBe(en.systemPrompt);
    expect(nl.errors.aiProcessingFailed).not.toBe(en.errors.aiProcessingFailed);
  });

  it('default system prompt does not unconditionally instruct the model to call getCmsConfig (LCMS-311)', () => {
    // getCmsConfig is not a built-in tool; the prompt must only reference it conditionally
    // so deployments without a custom getCmsConfig tool don't get model errors.
    expect(en.systemPrompt).not.toMatch(/^\d+\.\s+Use getCmsConfig/m);
    expect(nl.systemPrompt).not.toMatch(/^\d+\.\s+Gebruik getCmsConfig/m);
  });

  it('default system prompt mentions getDocumentData and updateDocument (the real built-in tools)', () => {
    expect(en.systemPrompt).toContain('getDocumentData');
    expect(en.systemPrompt).toContain('updateDocument');
    expect(nl.systemPrompt).toContain('getDocumentData');
    expect(nl.systemPrompt).toContain('updateDocument');
  });
});
