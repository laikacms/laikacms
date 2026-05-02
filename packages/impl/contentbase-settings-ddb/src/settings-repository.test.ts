import { describe, expect, it } from 'vitest';
import { DynamoDBContentBaseSettingsProvider } from './settings-repository.js';

describe('DynamoDBContentBaseSettingsProvider (smoke)', () => {
  it('is exported as a constructor', () => {
    expect(typeof DynamoDBContentBaseSettingsProvider).toBe('function');
    expect(DynamoDBContentBaseSettingsProvider.prototype).toBeTruthy();
  });

  it('exposes the documented public methods on its prototype', () => {
    const proto = DynamoDBContentBaseSettingsProvider.prototype as Record<string, unknown>;
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
      expect(typeof proto[method], `expected method ${method} to exist`).toBe('function');
    }
  });

  it('stores constructor arguments without performing I/O', () => {
    // Verifies that constructing the provider doesn't reach out to DynamoDB.
    // We pass `null` casts because the constructor only stores the references
    // and computes the PK/SK strings synchronously.
    const provider = new DynamoDBContentBaseSettingsProvider(
      null as never,
      'my-table',
      'my-project',
    );
    expect(provider).toBeInstanceOf(DynamoDBContentBaseSettingsProvider);
  });
});
