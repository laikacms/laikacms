import * as DateTime from 'effect/DateTime';
import { describe, expect, it } from 'vitest';

import { type Asset, type AssetCreate, type AssetUpdate, type AssetUrl, type AssetVariations } from 'laikacms/assets';
import { type Folder, type FolderCreate, type FolderSummary } from 'laikacms/storage';

import {
  assetCreateFromJsonApi,
  assetCreateToJsonApi,
  assetFromJsonApi,
  assetToJsonApi,
  assetUpdateFromJsonApi,
  assetUpdateToJsonApi,
  assetUrlFromJsonApi,
  assetUrlToJsonApi,
  assetVariationsFromJsonApi,
  assetVariationsToJsonApi,
  folderCreateFromJsonApi,
  folderCreateToJsonApi,
  folderFromJsonApi,
  folderSummaryFromJsonApi,
  folderSummaryToJsonApi,
  folderToJsonApi,
  includedFromJsonApi,
  includedToJsonApi,
  isJsonApiAsset,
  isJsonApiAssetUrl,
  isJsonApiAssetVariations,
  isJsonApiFolder,
  type JsonApiAsset,
  type JsonApiFolder,
  parseAsset,
  parseAssetUrl,
  parseAssetVariations,
  parseFolder,
  parseResource,
  resourceFromJsonApi,
  resourceToJsonApi,
} from './jsonapi.js';

// ─── fixtures ──────────────────────────────────────────────────────────────

const fullAsset: Asset = {
  key: 'images/photo.jpg',
  type: 'asset',
  content: { source: 's3', etag: 'abc123' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  version: 'v1',
};

const minimalAsset: Asset = {
  key: 'images/min.jpg',
  type: 'asset',
  content: {},
};

const fullAssetCreate: AssetCreate = {
  key: 'images/new.png',
  content: new Uint8Array([1, 2, 3]),
  mimeType: 'image/png',
  filename: 'new.png',
  customMetadata: { alt: 'A photo' },
  cacheControl: 'no-cache',
};

const minimalAssetCreate: AssetCreate = {
  key: 'images/min.png',
  content: new Uint8Array([]),
  mimeType: 'image/png',
};

const fullAssetUpdate: AssetUpdate = {
  key: 'images/photo.jpg',
  customMetadata: { alt: 'Updated alt' },
  cacheControl: 'max-age=3600',
  mimeType: 'image/jpeg',
};

const minimalAssetUpdate: AssetUpdate = {
  key: 'images/photo.jpg',
};

const fullFolder: Folder = {
  key: 'images/',
  type: 'folder',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

const minimalFolder: Folder = {
  key: 'images/',
  type: 'folder',
};

const fullFolderCreate: FolderCreate = {
  key: 'uploads/',
  type: 'folder',
};

const minimalFolderCreate: FolderCreate = {
  key: 'uploads/',
};

const fullFolderSummary: FolderSummary = {
  type: 'folder-summary',
  key: 'images/',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

const minimalFolderSummary: FolderSummary = {
  type: 'folder-summary',
  key: 'images/',
};

const fullAssetUrl: AssetUrl = {
  key: 'images/photo.jpg',
  url: 'https://cdn.example.com/photo.jpg',
  expiresAt: DateTime.makeUnsafe('2026-12-31T00:00:00Z'),
};

const minimalAssetUrl: AssetUrl = {
  key: 'images/photo.jpg',
};

const fullAssetVariations: AssetVariations = {
  key: 'images/photo.jpg',
  variations: {
    thumbnail: { variant: 'thumbnail', url: 'https://cdn.example.com/thumb.jpg', width: 100, height: 100 },
    large: { variant: 'large', url: 'https://cdn.example.com/large.jpg', mimeType: 'image/webp', size: 40960 },
  },
};

const emptyAssetVariations: AssetVariations = {
  key: 'images/empty.jpg',
  variations: {},
};

// ─── to JSON:API converters ──────────────────────────────────────────────

describe('assetToJsonApi', () => {
  it('maps key to id and drops key/type from attributes', () => {
    const result = assetToJsonApi(fullAsset);
    expect(result).toEqual({
      type: 'asset',
      id: 'images/photo.jpg',
      attributes: {
        content: fullAsset.content,
        createdAt: fullAsset.createdAt,
        updatedAt: fullAsset.updatedAt,
        version: fullAsset.version,
      },
    });
  });

  it('handles an asset with no optional fields set', () => {
    const result = assetToJsonApi(minimalAsset);
    expect(result).toEqual({
      type: 'asset',
      id: 'images/min.jpg',
      attributes: { content: {} },
    });
    expect(result.attributes).not.toHaveProperty('version');
  });
});

describe('assetCreateToJsonApi', () => {
  it('maps key to id and drops key from attributes', () => {
    const result = assetCreateToJsonApi(fullAssetCreate);
    expect(result.type).toBe('asset');
    expect(result.id).toBe('images/new.png');
    expect(result.attributes).toEqual({
      content: fullAssetCreate.content,
      mimeType: fullAssetCreate.mimeType,
      filename: fullAssetCreate.filename,
      customMetadata: fullAssetCreate.customMetadata,
      cacheControl: fullAssetCreate.cacheControl,
    });
  });

  it('handles a create payload with only the required fields', () => {
    const result = assetCreateToJsonApi(minimalAssetCreate);
    expect(result).toEqual({
      type: 'asset',
      id: 'images/min.png',
      attributes: { content: minimalAssetCreate.content, mimeType: 'image/png' },
    });
  });
});

describe('assetUpdateToJsonApi', () => {
  it('maps key to id and drops key from attributes', () => {
    const result = assetUpdateToJsonApi(fullAssetUpdate);
    expect(result).toEqual({
      type: 'asset',
      id: 'images/photo.jpg',
      attributes: {
        customMetadata: fullAssetUpdate.customMetadata,
        cacheControl: fullAssetUpdate.cacheControl,
        mimeType: fullAssetUpdate.mimeType,
      },
    });
  });

  it('handles an update payload with only the key set', () => {
    const result = assetUpdateToJsonApi(minimalAssetUpdate);
    expect(result).toEqual({
      type: 'asset',
      id: 'images/photo.jpg',
      attributes: {},
    });
  });
});

describe('folderToJsonApi', () => {
  it('maps key to id and drops key/type from attributes', () => {
    const result = folderToJsonApi(fullFolder);
    expect(result).toEqual({
      type: 'folder',
      id: 'images/',
      attributes: { createdAt: fullFolder.createdAt, updatedAt: fullFolder.updatedAt },
    });
  });

  it('handles a folder with no optional fields set', () => {
    const result = folderToJsonApi(minimalFolder);
    expect(result).toEqual({ type: 'folder', id: 'images/', attributes: {} });
  });
});

describe('folderCreateToJsonApi', () => {
  it('maps key to id and drops key/type from attributes', () => {
    const result = folderCreateToJsonApi(fullFolderCreate);
    expect(result).toEqual({ type: 'folder', id: 'uploads/', attributes: {} });
  });

  it('handles a create payload with type omitted', () => {
    const result = folderCreateToJsonApi(minimalFolderCreate);
    expect(result).toEqual({ type: 'folder', id: 'uploads/', attributes: {} });
  });
});

describe('folderSummaryToJsonApi', () => {
  it('maps key to id and drops key/type from attributes', () => {
    const result = folderSummaryToJsonApi(fullFolderSummary);
    expect(result).toEqual({
      type: 'folder-summary',
      id: 'images/',
      attributes: { createdAt: fullFolderSummary.createdAt, updatedAt: fullFolderSummary.updatedAt },
    });
  });

  it('handles a folder summary with no optional fields set', () => {
    const result = folderSummaryToJsonApi(minimalFolderSummary);
    expect(result).toEqual({ type: 'folder-summary', id: 'images/', attributes: {} });
  });
});

describe('assetUrlToJsonApi', () => {
  it('maps key to id and drops key from attributes', () => {
    const result = assetUrlToJsonApi(fullAssetUrl);
    expect(result).toEqual({
      type: 'asset-url',
      id: 'images/photo.jpg',
      attributes: { url: fullAssetUrl.url, expiresAt: fullAssetUrl.expiresAt },
    });
  });

  it('handles a URL entry with no optional fields set', () => {
    const result = assetUrlToJsonApi(minimalAssetUrl);
    expect(result).toEqual({ type: 'asset-url', id: 'images/photo.jpg', attributes: {} });
  });
});

describe('assetVariationsToJsonApi', () => {
  it('maps key to id and drops key from attributes', () => {
    const result = assetVariationsToJsonApi(fullAssetVariations);
    expect(result).toEqual({
      type: 'asset-variants',
      id: 'images/photo.jpg',
      attributes: { variations: fullAssetVariations.variations },
    });
  });

  it('handles an empty variations record', () => {
    const result = assetVariationsToJsonApi(emptyAssetVariations);
    expect(result).toEqual({
      type: 'asset-variants',
      id: 'images/empty.jpg',
      attributes: { variations: {} },
    });
  });
});

describe('resourceToJsonApi', () => {
  it('delegates to assetToJsonApi for an asset resource', () => {
    expect(resourceToJsonApi(fullAsset)).toEqual(assetToJsonApi(fullAsset));
  });

  it('delegates to folderToJsonApi for a folder resource', () => {
    expect(resourceToJsonApi(fullFolder)).toEqual(folderToJsonApi(fullFolder));
  });
});

// ─── from JSON:API converters ──────────────────────────────────────────────

describe('assetFromJsonApi', () => {
  it('round-trips a fully populated asset', () => {
    expect(assetFromJsonApi(assetToJsonApi(fullAsset))).toEqual(fullAsset);
  });

  it('round-trips a minimal asset with no optional fields', () => {
    expect(assetFromJsonApi(assetToJsonApi(minimalAsset))).toEqual(minimalAsset);
  });
});

describe('assetCreateFromJsonApi', () => {
  it('round-trips a fully populated create payload (modulo the injected type field)', () => {
    const result = assetCreateFromJsonApi(assetCreateToJsonApi(fullAssetCreate));
    expect(result).toEqual({ ...fullAssetCreate, type: 'asset' });
  });

  it('round-trips a minimal create payload', () => {
    const result = assetCreateFromJsonApi(assetCreateToJsonApi(minimalAssetCreate));
    expect(result).toEqual({ ...minimalAssetCreate, type: 'asset' });
  });
});

describe('assetUpdateFromJsonApi', () => {
  it('round-trips a fully populated update payload', () => {
    expect(assetUpdateFromJsonApi(assetUpdateToJsonApi(fullAssetUpdate))).toEqual(fullAssetUpdate);
  });

  it('round-trips a minimal update payload with only key set', () => {
    expect(assetUpdateFromJsonApi(assetUpdateToJsonApi(minimalAssetUpdate))).toEqual(minimalAssetUpdate);
  });
});

describe('folderFromJsonApi', () => {
  it('round-trips a fully populated folder', () => {
    expect(folderFromJsonApi(folderToJsonApi(fullFolder))).toEqual(fullFolder);
  });

  it('round-trips a minimal folder with no optional fields', () => {
    expect(folderFromJsonApi(folderToJsonApi(minimalFolder))).toEqual(minimalFolder);
  });
});

describe('folderCreateFromJsonApi', () => {
  it('does not restore the type field dropped during folderCreateToJsonApi', () => {
    const result = folderCreateFromJsonApi(folderCreateToJsonApi(fullFolderCreate));
    // `folderCreateToJsonApi` strips `type` into the JSON:API resource type
    // itself, and `folderCreateFromJsonApi` never reconstructs it — the
    // round trip intentionally loses this field.
    expect(result).toEqual({ key: fullFolderCreate.key });
    expect(result).not.toHaveProperty('type');
  });

  it('round-trips a payload that never had a type field', () => {
    const result = folderCreateFromJsonApi(folderCreateToJsonApi(minimalFolderCreate));
    expect(result).toEqual(minimalFolderCreate);
  });
});

describe('folderSummaryFromJsonApi', () => {
  it('round-trips a fully populated folder summary', () => {
    expect(folderSummaryFromJsonApi(folderSummaryToJsonApi(fullFolderSummary))).toEqual(fullFolderSummary);
  });

  it('round-trips a minimal folder summary with no optional fields', () => {
    expect(folderSummaryFromJsonApi(folderSummaryToJsonApi(minimalFolderSummary))).toEqual(minimalFolderSummary);
  });
});

describe('assetUrlFromJsonApi', () => {
  it('round-trips a fully populated URL entry', () => {
    expect(assetUrlFromJsonApi(assetUrlToJsonApi(fullAssetUrl))).toEqual(fullAssetUrl);
  });

  it('round-trips a URL entry with no optional fields set', () => {
    expect(assetUrlFromJsonApi(assetUrlToJsonApi(minimalAssetUrl))).toEqual(minimalAssetUrl);
  });
});

describe('assetVariationsFromJsonApi', () => {
  it('round-trips a fully populated variations record', () => {
    expect(assetVariationsFromJsonApi(assetVariationsToJsonApi(fullAssetVariations))).toEqual(fullAssetVariations);
  });

  it('round-trips an empty variations record', () => {
    expect(assetVariationsFromJsonApi(assetVariationsToJsonApi(emptyAssetVariations))).toEqual(emptyAssetVariations);
  });
});

describe('resourceFromJsonApi', () => {
  it('delegates to assetFromJsonApi for a JSON:API asset resource', () => {
    const jsonApiAsset = assetToJsonApi(fullAsset);
    expect(resourceFromJsonApi(jsonApiAsset)).toEqual(assetFromJsonApi(jsonApiAsset));
  });

  it('delegates to folderFromJsonApi for a JSON:API folder resource', () => {
    const jsonApiFolder = folderToJsonApi(fullFolder);
    expect(resourceFromJsonApi(jsonApiFolder)).toEqual(folderFromJsonApi(jsonApiFolder));
  });
});

describe('includedFromJsonApi', () => {
  it('delegates to assetUrlFromJsonApi for an asset-url resource', () => {
    const jsonApiUrl = assetUrlToJsonApi(fullAssetUrl);
    expect(includedFromJsonApi(jsonApiUrl)).toEqual(assetUrlFromJsonApi(jsonApiUrl));
  });

  it('delegates to assetVariationsFromJsonApi for an asset-variants resource', () => {
    const jsonApiVariations = assetVariationsToJsonApi(fullAssetVariations);
    expect(includedFromJsonApi(jsonApiVariations)).toEqual(assetVariationsFromJsonApi(jsonApiVariations));
  });
});

describe('includedToJsonApi', () => {
  it('serializes an AssetUrl (detected via the `url` key) as asset-url', () => {
    expect(includedToJsonApi(fullAssetUrl)).toEqual(assetUrlToJsonApi(fullAssetUrl));
  });

  it('falls through to the variations branch when `url` was never assigned (`in` check, not value check)', () => {
    // The dispatch is `'url' in included`, an *own-property* check — an
    // AssetUrl built without ever assigning `url` (as opposed to assigning
    // `url: undefined`) has no such property and is mis-routed to the
    // asset-variants serializer. This documents that existing behavior.
    expect(includedToJsonApi(minimalAssetUrl)).toEqual(
      assetVariationsToJsonApi(minimalAssetUrl as unknown as AssetVariations),
    );
  });

  it('serializes an AssetVariations as asset-variants', () => {
    expect(includedToJsonApi(fullAssetVariations)).toEqual(assetVariationsToJsonApi(fullAssetVariations));
  });

  it('serializes an empty AssetVariations as asset-variants', () => {
    expect(includedToJsonApi(emptyAssetVariations)).toEqual(assetVariationsToJsonApi(emptyAssetVariations));
  });
});

// ─── type guards ─────────────────────────────────────────────────────────

describe('isJsonApiAsset', () => {
  it('returns true for an asset resource', () => {
    expect(isJsonApiAsset(assetToJsonApi(fullAsset))).toBe(true);
  });

  it('returns false for a folder resource', () => {
    expect(isJsonApiAsset(folderToJsonApi(fullFolder))).toBe(false);
  });
});

describe('isJsonApiFolder', () => {
  it('returns true for a folder resource', () => {
    expect(isJsonApiFolder(folderToJsonApi(fullFolder))).toBe(true);
  });

  it('returns false for an asset resource', () => {
    expect(isJsonApiFolder(assetToJsonApi(fullAsset))).toBe(false);
  });
});

describe('isJsonApiAssetUrl', () => {
  it('returns true for an asset-url resource', () => {
    expect(isJsonApiAssetUrl(assetUrlToJsonApi(fullAssetUrl))).toBe(true);
  });

  it('returns false for an asset-variants resource', () => {
    expect(isJsonApiAssetUrl(assetVariationsToJsonApi(fullAssetVariations))).toBe(false);
  });
});

describe('isJsonApiAssetVariations', () => {
  it('returns true for an asset-variants resource', () => {
    expect(isJsonApiAssetVariations(assetVariationsToJsonApi(fullAssetVariations))).toBe(true);
  });

  it('returns false for an asset-url resource', () => {
    expect(isJsonApiAssetVariations(assetUrlToJsonApi(fullAssetUrl))).toBe(false);
  });

  it('returns true for an empty variations resource', () => {
    expect(isJsonApiAssetVariations(assetVariationsToJsonApi(emptyAssetVariations))).toBe(true);
  });
});

// ─── generic converters ──────────────────────────────────────────────────

describe('parseResource', () => {
  it('parses a generic asset resource into a domain Asset', () => {
    const generic: JsonApiAsset = { type: 'asset', id: 'images/photo.jpg', attributes: { content: {} } };
    expect(parseResource(generic)).toEqual({ key: 'images/photo.jpg', type: 'asset', content: {} });
  });

  it('parses a generic non-asset resource into a domain Folder', () => {
    const generic: JsonApiFolder = { type: 'folder', id: 'images/', attributes: {} };
    expect(parseResource(generic)).toEqual({ key: 'images/', type: 'folder' });
  });

  it('parses a resource with no attributes set', () => {
    expect(parseResource({ type: 'asset', id: 'images/bare.jpg' })).toEqual({
      key: 'images/bare.jpg',
      type: 'asset',
    });
  });
});

describe('parseAsset', () => {
  it('parses a generic resource into a domain Asset', () => {
    expect(parseAsset({ type: 'asset', id: 'images/photo.jpg', attributes: { content: { a: 1 } } })).toEqual({
      key: 'images/photo.jpg',
      type: 'asset',
      content: { a: 1 },
    });
  });

  it('parses a resource with no attributes set', () => {
    expect(parseAsset({ type: 'asset', id: 'images/bare.jpg' })).toEqual({ key: 'images/bare.jpg', type: 'asset' });
  });
});

describe('parseFolder', () => {
  it('parses a generic resource into a domain Folder', () => {
    expect(parseFolder({ type: 'folder', id: 'images/', attributes: { createdAt: '2026-01-01T00:00:00Z' } }))
      .toEqual({ key: 'images/', type: 'folder', createdAt: '2026-01-01T00:00:00Z' });
  });

  it('parses a resource with no attributes set', () => {
    expect(parseFolder({ type: 'folder', id: 'images/' })).toEqual({ key: 'images/', type: 'folder' });
  });
});

describe('parseAssetUrl', () => {
  it('parses a generic resource into an AssetUrl', () => {
    expect(
      parseAssetUrl({ type: 'asset-url', id: 'images/photo.jpg', attributes: { url: 'https://cdn/x.jpg' } }),
    ).toEqual({ key: 'images/photo.jpg', url: 'https://cdn/x.jpg' });
  });

  it('parses a resource with no attributes set', () => {
    expect(parseAssetUrl({ type: 'asset-url', id: 'images/photo.jpg' })).toEqual({ key: 'images/photo.jpg' });
  });
});

describe('parseAssetVariations', () => {
  it('parses a generic resource into AssetVariations', () => {
    expect(
      parseAssetVariations({
        type: 'asset-variants',
        id: 'images/photo.jpg',
        attributes: { variations: { thumbnail: { variant: 'thumbnail', url: 'https://cdn/t.jpg' } } },
      }),
    ).toEqual({
      key: 'images/photo.jpg',
      variations: { thumbnail: { variant: 'thumbnail', url: 'https://cdn/t.jpg' } },
    });
  });

  it('parses a resource with an empty variations record', () => {
    expect(
      parseAssetVariations({ type: 'asset-variants', id: 'images/photo.jpg', attributes: { variations: {} } }),
    ).toEqual({ key: 'images/photo.jpg', variations: {} });
  });
});
