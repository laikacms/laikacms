import { describe, expect, it } from 'vitest';
import en from './en';
import nl from './nl';

describe('widget i18n bundles', () => {
  it('default (en) bundle is English, not Dutch', () => {
    // Guards against the wrong-module import bug (LCMS-182)
    expect(en.aiAssistant).toBe('AI Assistant');
    expect(en.newConversation).toBe('New conversation');
    expect(en.defaultPlaceholder).toBe('Ask the AI assistant...');
  });

  it('nl bundle is structurally identical to en (same keys)', () => {
    const enKeys = Object.keys(en).sort();
    const nlKeys = Object.keys(nl).sort();
    expect(nlKeys).toEqual(enKeys);
  });

  it('nl bundle is Dutch, not English', () => {
    expect(nl.aiAssistant).not.toBe(en.aiAssistant);
  });
});
