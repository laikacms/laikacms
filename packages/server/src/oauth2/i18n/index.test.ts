import { describe, expect, it } from 'vitest';
import { defaultMessages, en, nl } from './index.js';
import { en as enTranslations } from './translations/en.js';
import { nl as nlTranslations } from './translations/nl.js';

describe('oauth2/i18n index', () => {
  it('re-exports en as documented in the README', () => {
    expect(en).toBe(enTranslations);
  });

  it('re-exports nl as documented in the README', () => {
    expect(nl).toBe(nlTranslations);
  });

  it('defaults to the English messages', () => {
    expect(defaultMessages).toBe(en);
  });

  it('keeps en and nl in key-parity', () => {
    const enKeys = Object.keys(en).sort();
    const nlKeys = Object.keys(nl).sort();
    expect(nlKeys).toEqual(enKeys);
  });
});
