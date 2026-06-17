import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import * as Result from 'effect/Result';
import { InternalError, InvalidData, ValidationError } from 'laikacms/core';
import superjson from 'superjson';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DynamoDBContentBaseSettingsProvider } from './settings-repository.js';

// Minimal valid collection shapes that satisfy the Effect schema (key is required)
const VALID_DOCUMENT_COLLECTION = {
  type: 'document' as const,
  key: 'posts',
};

const VALID_MEDIA_COLLECTION = {
  type: 'media' as const,
  key: 'images',
};

const TABLE = 'settings-table';
const PROJECT_ID = 'proj-123';
const PK = `PROJECT#${PROJECT_ID}`;
const SK = 'SETTINGS';

const makeProvider = () =>
  new DynamoDBContentBaseSettingsProvider(
    DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' })),
    TABLE,
    PROJECT_ID,
  );

let ddbMock: ReturnType<typeof mockClient>;

beforeEach(() => {
  ddbMock = mockClient(DynamoDBDocumentClient);
});

afterEach(() => {
  ddbMock.restore();
});

// ---------------------------------------------------------------------------
// getSettings — happy path
// ---------------------------------------------------------------------------

describe('getSettings — happy path', () => {
  it('deserializes collections from the DDB item via superjson', async () => {
    const storedDocument = {
      collections: {
        posts: VALID_DOCUMENT_COLLECTION,
      },
      schemas: {},
    };

    ddbMock.on(GetCommand).resolves({ Item: { PK, SK, settings: superjson.serialize(storedDocument) } });

    const provider = makeProvider();
    const result = await provider.getSettings();

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.collections).toHaveProperty('posts');
      expect((result.success.collections as Record<string, unknown>)['posts']).toMatchObject({ type: 'document' });
    }
  });
});

// ---------------------------------------------------------------------------
// getSettings — item missing → default fallback
// ---------------------------------------------------------------------------

describe('getSettings — item not found', () => {
  it('creates and stores default settings when DDB item is absent', async () => {
    // First GetCommand: item not found → empty response
    // PutCommand: save defaults
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const provider = makeProvider();
    const result = await provider.getSettings();

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      // Default has empty collections object
      expect(result.success.collections).toBeDefined();
      expect(typeof result.success.collections).toBe('object');
    }

    // The Put to store defaults must have been called exactly once
    const putCalls = ddbMock.commandCalls(PutCommand);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].args[0].input.TableName).toBe(TABLE);
    expect(putCalls[0].args[0].input.Item?.PK).toBe(PK);
    expect(putCalls[0].args[0].input.Item?.SK).toBe(SK);
  });
});

// ---------------------------------------------------------------------------
// getSettings — DDB throws → InternalError
// ---------------------------------------------------------------------------

describe('getSettings — DynamoDB error', () => {
  it('maps a DynamoDB failure to InternalError', async () => {
    ddbMock.on(GetCommand).rejects(new Error('ProvisionedThroughputExceededException'));

    const provider = makeProvider();
    const result = await provider.getSettings();

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(InternalError);
    }
  });
});

// ---------------------------------------------------------------------------
// getSettings — corrupt data → InvalidData / ValidationError
// ---------------------------------------------------------------------------

describe('getSettings — invalid data', () => {
  it('returns a failure when deserialized data fails schema validation', async () => {
    // Serialize something that is not a valid ContentBaseSettings
    const badDocument = { collections: { bad: { type: 'totally-unknown-type-xyz' } }, schemas: {} };

    ddbMock.on(GetCommand).resolves({ Item: { PK, SK, settings: superjson.serialize(badDocument) } });

    const provider = makeProvider();
    const result = await provider.getSettings();

    // parseSettings returns a ValidationError for unknown collection types
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(ValidationError);
    }
  });
});

// ---------------------------------------------------------------------------
// putSettings — happy path
// ---------------------------------------------------------------------------

describe('putSettings — happy path', () => {
  it('serializes collections via superjson and calls DDB PutCommand', async () => {
    const existingDocument = { collections: {}, schemas: {} };
    ddbMock.on(GetCommand).resolves({ Item: { PK, SK, settings: superjson.serialize(existingDocument) } });
    ddbMock.on(PutCommand).resolves({});

    const provider = makeProvider();
    const newSettings = {
      collections: {
        articles: { type: 'document' as const, key: 'articles' },
      },
    };

    const result = await provider.putSettings(newSettings);

    expect(Result.isSuccess(result)).toBe(true);

    const putCalls = ddbMock.commandCalls(PutCommand);
    expect(putCalls).toHaveLength(1);
    const item = putCalls[0].args[0].input.Item!;
    expect(item.PK).toBe(PK);
    expect(item.SK).toBe(SK);

    // The stored item must be superjson-serialized and roundtrippable back to our data
    const deserialized = superjson.deserialize(item.settings as ReturnType<typeof superjson.serialize>) as {
      collections: Record<string, unknown>,
    };
    expect(deserialized.collections).toHaveProperty('articles');
  });
});

// ---------------------------------------------------------------------------
// putSettings — DDB error → InternalError
// ---------------------------------------------------------------------------

describe('putSettings — DynamoDB error', () => {
  it('maps a DynamoDB failure during put to InternalError', async () => {
    const existingDocument = { collections: {}, schemas: {} };
    ddbMock.on(GetCommand).resolves({ Item: { PK, SK, settings: superjson.serialize(existingDocument) } });
    ddbMock.on(PutCommand).rejects(new Error('ServiceUnavailable'));

    const provider = makeProvider();
    const result = await provider.putSettings({ collections: {} });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(InternalError);
    }
  });
});

// ---------------------------------------------------------------------------
// getCollectionSettings
// ---------------------------------------------------------------------------

describe('getCollectionSettings', () => {
  it('returns the named collection when it exists', async () => {
    const doc = {
      collections: {
        pages: { type: 'document' as const, key: 'pages' },
      },
      schemas: {},
    };
    ddbMock.on(GetCommand).resolves({ Item: { PK, SK, settings: superjson.serialize(doc) } });

    const provider = makeProvider();
    const result = await provider.getCollectionSettings('pages');

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.type).toBe('document');
    }
  });

  it('returns NotFoundError for a missing collection', async () => {
    const doc = { collections: {}, schemas: {} };
    ddbMock.on(GetCommand).resolves({ Item: { PK, SK, settings: superjson.serialize(doc) } });

    const provider = makeProvider();
    const result = await provider.getCollectionSettings('nonexistent');

    expect(Result.isFailure(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getDocumentCollectionSettings / getMediaCollectionSettings type guards
// ---------------------------------------------------------------------------

describe('getDocumentCollectionSettings', () => {
  it('returns InvalidData when the collection type is not "document"', async () => {
    const doc = {
      collections: {
        images: VALID_MEDIA_COLLECTION,
      },
      schemas: {},
    };
    ddbMock.on(GetCommand).resolves({ Item: { PK, SK, settings: superjson.serialize(doc) } });

    const provider = makeProvider();
    const result = await provider.getDocumentCollectionSettings('images');

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(InvalidData);
    }
  });
});

describe('getMediaCollectionSettings', () => {
  it('returns InvalidData when the collection type is not "media"', async () => {
    const doc = {
      collections: {
        posts: VALID_DOCUMENT_COLLECTION,
      },
      schemas: {},
    };
    ddbMock.on(GetCommand).resolves({ Item: { PK, SK, settings: superjson.serialize(doc) } });

    const provider = makeProvider();
    const result = await provider.getMediaCollectionSettings('posts');

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(InvalidData);
    }
  });
});

// ---------------------------------------------------------------------------
// getCollectionSchema / putCollectionSchema
// ---------------------------------------------------------------------------

describe('getCollectionSchema', () => {
  it('returns the stored JSON Schema for a collection', async () => {
    const schema = { type: 'object', properties: { title: { type: 'string' } } };
    const doc = { collections: {}, schemas: { posts: schema } };
    ddbMock.on(GetCommand).resolves({ Item: { PK, SK, settings: superjson.serialize(doc) } });

    const provider = makeProvider();
    const result = await provider.getCollectionSchema('posts');

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toMatchObject(schema);
    }
  });

  it('returns NotFoundError for a missing schema', async () => {
    const doc = { collections: {}, schemas: {} };
    ddbMock.on(GetCommand).resolves({ Item: { PK, SK, settings: superjson.serialize(doc) } });

    const provider = makeProvider();
    const result = await provider.getCollectionSchema('missing');

    expect(Result.isFailure(result)).toBe(true);
  });
});

describe('putCollectionSchema', () => {
  it('stores the schema alongside existing data', async () => {
    const doc = { collections: {}, schemas: {} };
    ddbMock.on(GetCommand).resolves({ Item: { PK, SK, settings: superjson.serialize(doc) } });
    ddbMock.on(PutCommand).resolves({});

    const provider = makeProvider();
    const schema = { type: 'object' as const, properties: { body: { type: 'string' as const } } };
    const result = await provider.putCollectionSchema('articles', schema);

    expect(Result.isSuccess(result)).toBe(true);

    const putCalls = ddbMock.commandCalls(PutCommand);
    expect(putCalls).toHaveLength(1);
    const stored = superjson.deserialize(
      putCalls[0].args[0].input.Item!.settings as ReturnType<typeof superjson.serialize>,
    ) as {
      schemas: Record<string, unknown>,
    };
    expect(stored.schemas).toHaveProperty('articles');
  });
});
