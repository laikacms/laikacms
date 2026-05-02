import { describe, expect, it } from 'vitest';
import { DefaultContentBaseSettingsProvider } from './settings-repository.js';

describe('DefaultContentBaseSettingsProvider (smoke)', () => {
  it('is exported as a constructor', () => {
    expect(typeof DefaultContentBaseSettingsProvider).toBe('function');
    expect(DefaultContentBaseSettingsProvider.prototype).toBeTruthy();
  });

  it('exposes the documented public methods on its prototype', () => {
    const proto = DefaultContentBaseSettingsProvider.prototype;
    for (
      const method of [
        'getSettings',
        'putSettings',
        'getCollectionSettings',
        'putCollectionSettings',
        'getDocumentCollectionSettings',
        'putDocumentCollectionSettings',
        'getMediaCollectionSettings',
        'putMediaCollectionSettings',
        'getCollectionSchema',
        'putCollectionSchema',
      ]
    ) {
      // getSettings is defined as an instance arrow-function (own property), so
      // check both prototype and a stub instance.
      const onProto = typeof (proto as Record<string, unknown>)[method] === 'function';
      const onInstance = typeof (
        new DefaultContentBaseSettingsProvider({} as never) as unknown as Record<string, unknown>
      )[method] === 'function';
      expect(onProto || onInstance, `expected method ${method} to exist`).toBe(true);
    }
  });
});
