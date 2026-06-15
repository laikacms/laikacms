import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createS3Bucket } from './index.js';
import type { S3ClientLike, S3Commands } from './index.js';

// ---------------------------------------------------------------------------
// Minimal mock command classes — the adapter only uses `new Cmd(input)` and
// passes the resulting object to `client.send()`.  We capture the input so
// assertions can inspect what the adapter passed to the S3 client.
// ---------------------------------------------------------------------------

function makeCmd(name: string) {
  return class {
    readonly _name = name;
    constructor(public readonly input: object) {}
  };
}

const commands: S3Commands = {
  HeadObjectCommand: makeCmd('HeadObjectCommand') as unknown as S3Commands['HeadObjectCommand'],
  GetObjectCommand: makeCmd('GetObjectCommand') as unknown as S3Commands['GetObjectCommand'],
  PutObjectCommand: makeCmd('PutObjectCommand') as unknown as S3Commands['PutObjectCommand'],
  DeleteObjectCommand: makeCmd('DeleteObjectCommand') as unknown as S3Commands['DeleteObjectCommand'],
  ListObjectsV2Command: makeCmd('ListObjectsV2Command') as unknown as S3Commands['ListObjectsV2Command'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBucket(sendImpl: (cmd: object) => Promise<unknown>, keyPrefix = '') {
  const client: S3ClientLike = { send: vi.fn(sendImpl) };
  const bucket = createS3Bucket({
    client,
    bucketName: 'test-bucket',
    commands,
    keyPrefix,
  });
  return { bucket, client };
}

// ---------------------------------------------------------------------------
// is404() — tested indirectly through head() and get()
// ---------------------------------------------------------------------------

describe('is404() detection', () => {
  describe('name-based detection', () => {
    it('returns null (treats as 404) when error name is "NotFound"', async () => {
      const { bucket } = makeBucket(() => Promise.reject(Object.assign(new Error('not found'), { name: 'NotFound' })));
      expect(await bucket.head('any-key')).toBeNull();
    });

    it('returns null (treats as 404) when error name is "NoSuchKey"', async () => {
      const { bucket } = makeBucket(() =>
        Promise.reject(Object.assign(new Error('no such key'), { name: 'NoSuchKey' }))
      );
      expect(await bucket.head('any-key')).toBeNull();
    });

    it('rethrows when error name is something else', async () => {
      const err = Object.assign(new Error('access denied'), { name: 'AccessDenied' });
      const { bucket } = makeBucket(() => Promise.reject(err));
      await expect(bucket.head('any-key')).rejects.toThrow('access denied');
    });
  });

  describe('httpStatusCode-based detection', () => {
    it('returns null (treats as 404) when $metadata.httpStatusCode is 404', async () => {
      const err = Object.assign(new Error('not found'), {
        $metadata: { httpStatusCode: 404 },
      });
      const { bucket } = makeBucket(() => Promise.reject(err));
      expect(await bucket.head('any-key')).toBeNull();
    });

    it('rethrows when $metadata.httpStatusCode is 403', async () => {
      const err = Object.assign(new Error('forbidden'), {
        $metadata: { httpStatusCode: 403 },
      });
      const { bucket } = makeBucket(() => Promise.reject(err));
      await expect(bucket.head('any-key')).rejects.toThrow('forbidden');
    });

    it('rethrows when $metadata.httpStatusCode is 500', async () => {
      const err = Object.assign(new Error('server error'), {
        $metadata: { httpStatusCode: 500 },
      });
      const { bucket } = makeBucket(() => Promise.reject(err));
      await expect(bucket.head('any-key')).rejects.toThrow('server error');
    });
  });
});

// ---------------------------------------------------------------------------
// head()
// ---------------------------------------------------------------------------

describe('head()', () => {
  it('returns an R2Object with key, size, etag on success', async () => {
    const { bucket } = makeBucket(() => Promise.resolve({ ContentLength: 42, ETag: '"abc123"' }));
    const result = await bucket.head('docs/hello.md');
    expect(result).toEqual({ key: 'docs/hello.md', size: 42, etag: '"abc123"' });
  });

  it('returns null on 404 (name-based)', async () => {
    const { bucket } = makeBucket(() => Promise.reject(Object.assign(new Error(), { name: 'NoSuchKey' })));
    expect(await bucket.head('missing')).toBeNull();
  });

  it('rethrows non-404 errors', async () => {
    const { bucket } = makeBucket(() =>
      Promise.reject(Object.assign(new Error('throttled'), { name: 'ThrottlingException' }))
    );
    await expect(bucket.head('x')).rejects.toThrow('throttled');
  });
});

// ---------------------------------------------------------------------------
// put()
// ---------------------------------------------------------------------------

describe('put()', () => {
  it('returns synthesized { key, size: 0, etag: "" } regardless of S3 response', async () => {
    const { bucket } = makeBucket(() => Promise.resolve({ ETag: '"server-etag"' }));
    const result = await bucket.put('docs/file.md', 'content');
    expect(result).toEqual({ key: 'docs/file.md', size: 0, etag: '' });
  });

  it('returns size: 0 even when S3 response is empty', async () => {
    const { bucket } = makeBucket(() => Promise.resolve({}));
    const result = await bucket.put('a.md', 'body');
    expect(result.size).toBe(0);
  });

  it('passes ContentType through when provided in httpMetadata', async () => {
    const client: S3ClientLike = { send: vi.fn(() => Promise.resolve({})) };
    const bucket = createS3Bucket({ client, bucketName: 'b', commands });
    await bucket.put('file.md', 'x', { httpMetadata: { contentType: 'text/markdown' } });
    expect(vi.mocked(client.send)).toHaveBeenCalledOnce();
    const cmd = vi.mocked(client.send).mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(cmd.input['ContentType']).toBe('text/markdown');
  });
});

// ---------------------------------------------------------------------------
// list() — keyPrefix stripping
// ---------------------------------------------------------------------------

describe('list() keyPrefix stripping', () => {
  it('strips keyPrefix from Contents[].Key', async () => {
    const { bucket } = makeBucket(() =>
      Promise.resolve({
        Contents: [
          { Key: 'content/docs/a.md', Size: 10, ETag: '"e1"' },
          { Key: 'content/docs/b.md', Size: 20, ETag: '"e2"' },
        ],
        CommonPrefixes: [],
        IsTruncated: false,
      }), 'content/');

    const result = await bucket.list({ prefix: 'docs/' });
    expect(result.objects).toEqual([
      { key: 'docs/a.md', size: 10, etag: '"e1"' },
      { key: 'docs/b.md', size: 20, etag: '"e2"' },
    ]);
  });

  it('strips keyPrefix from CommonPrefixes[].Prefix', async () => {
    const { bucket } = makeBucket(() =>
      Promise.resolve({
        Contents: [],
        CommonPrefixes: [
          { Prefix: 'content/posts/' },
          { Prefix: 'content/pages/' },
        ],
        IsTruncated: false,
      }), 'content/');

    const result = await bucket.list({ prefix: '', delimiter: '/' });
    expect(result.delimitedPrefixes).toEqual(['posts/', 'pages/']);
  });

  it('does not strip anything when keyPrefix is empty', async () => {
    const { bucket } = makeBucket(() =>
      Promise.resolve({
        Contents: [{ Key: 'docs/a.md', Size: 5, ETag: '"e"' }],
        CommonPrefixes: [{ Prefix: 'docs/sub/' }],
        IsTruncated: false,
      })
    );

    const result = await bucket.list({ prefix: 'docs/' });
    expect(result.objects[0]!.key).toBe('docs/a.md');
    expect(result.delimitedPrefixes[0]).toBe('docs/sub/');
  });

  it('filters out Contents entries with undefined Key', async () => {
    const { bucket } = makeBucket(() =>
      Promise.resolve({
        Contents: [
          { Key: undefined, Size: 0 },
          { Key: 'valid.md', Size: 1, ETag: '"e"' },
        ],
        IsTruncated: false,
      })
    );

    const result = await bucket.list({});
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0]!.key).toBe('valid.md');
  });
});

// ---------------------------------------------------------------------------
// list() — NextContinuationToken → cursor mapping
// ---------------------------------------------------------------------------

describe('list() pagination cursor mapping', () => {
  it('maps NextContinuationToken to cursor in the return value', async () => {
    const { bucket } = makeBucket(() =>
      Promise.resolve({
        Contents: [{ Key: 'a.md', Size: 1, ETag: '"e"' }],
        IsTruncated: true,
        NextContinuationToken: 'token-abc-123',
      })
    );

    const result = await bucket.list({});
    expect(result.cursor).toBe('token-abc-123');
    expect(result.truncated).toBe(true);
  });

  it('cursor is undefined when NextContinuationToken is absent', async () => {
    const { bucket } = makeBucket(() =>
      Promise.resolve({
        Contents: [],
        IsTruncated: false,
      })
    );

    const result = await bucket.list({});
    expect(result.cursor).toBeUndefined();
    expect(result.truncated).toBe(false);
  });

  it('passes cursor option as ContinuationToken to the S3 command', async () => {
    const client: S3ClientLike = { send: vi.fn(() => Promise.resolve({ Contents: [], IsTruncated: false })) };
    const bucket = createS3Bucket({ client, bucketName: 'b', commands });
    await bucket.list({ cursor: 'my-continuation-token' });
    const cmd = vi.mocked(client.send).mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(cmd.input['ContinuationToken']).toBe('my-continuation-token');
  });
});

// ---------------------------------------------------------------------------
// list() — prefix passed to S3 with keyPrefix prepended
// ---------------------------------------------------------------------------

describe('list() prefix construction', () => {
  it('prepends keyPrefix to the S3 Prefix when prefix is provided', async () => {
    const client: S3ClientLike = { send: vi.fn(() => Promise.resolve({ Contents: [], IsTruncated: false })) };
    const bucket = createS3Bucket({ client, bucketName: 'b', commands, keyPrefix: 'tenant/' });
    await bucket.list({ prefix: 'posts/' });
    const cmd = vi.mocked(client.send).mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(cmd.input['Prefix']).toBe('tenant/posts/');
  });

  it('uses keyPrefix alone as S3 Prefix when no prefix option given', async () => {
    const client: S3ClientLike = { send: vi.fn(() => Promise.resolve({ Contents: [], IsTruncated: false })) };
    const bucket = createS3Bucket({ client, bucketName: 'b', commands, keyPrefix: 'tenant/' });
    await bucket.list({});
    const cmd = vi.mocked(client.send).mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(cmd.input['Prefix']).toBe('tenant/');
  });
});

// ---------------------------------------------------------------------------
// get()
// ---------------------------------------------------------------------------

describe('get()', () => {
  it('returns null on 404', async () => {
    const { bucket } = makeBucket(() => Promise.reject(Object.assign(new Error(), { name: 'NoSuchKey' })));
    expect(await bucket.get('missing')).toBeNull();
  });

  it('returns null when Body is absent', async () => {
    const { bucket } = makeBucket(() => Promise.resolve({ ContentLength: 10, ETag: '"e"' }));
    expect(await bucket.get('key')).toBeNull();
  });

  it('returns an R2ObjectBody with working text() when Body is present', async () => {
    const { bucket } = makeBucket(() =>
      Promise.resolve({
        ContentLength: 5,
        ETag: '"etag"',
        Body: { transformToString: async () => 'hello' },
      })
    );
    const result = await bucket.get('file.md');
    expect(result).not.toBeNull();
    expect(result!.key).toBe('file.md');
    expect(result!.size).toBe(5);
    expect(await result!.text()).toBe('hello');
  });

  it('rethrows non-404 errors', async () => {
    const { bucket } = makeBucket(() => Promise.reject(Object.assign(new Error('boom'), { name: 'InternalError' })));
    await expect(bucket.get('key')).rejects.toThrow('boom');
  });
});

// ---------------------------------------------------------------------------
// delete()
// ---------------------------------------------------------------------------

describe('delete()', () => {
  it('calls the S3 client with the correct key', async () => {
    const client: S3ClientLike = { send: vi.fn(() => Promise.resolve({})) };
    const bucket = createS3Bucket({ client, bucketName: 'b', commands });
    await bucket.delete('to-remove.md');
    const cmd = vi.mocked(client.send).mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(cmd.input['Key']).toBe('to-remove.md');
  });

  it('prepends keyPrefix when deleting', async () => {
    const client: S3ClientLike = { send: vi.fn(() => Promise.resolve({})) };
    const bucket = createS3Bucket({ client, bucketName: 'b', commands, keyPrefix: 'ns/' });
    await bucket.delete('file.md');
    const cmd = vi.mocked(client.send).mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(cmd.input['Key']).toBe('ns/file.md');
  });
});
