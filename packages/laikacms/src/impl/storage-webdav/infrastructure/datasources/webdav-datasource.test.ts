import * as Result from 'effect/Result';
import { AuthenticationError, ConflictError, ForbiddenError, TooManyRequestsError } from 'laikacms/core';
import { describe, expect, it } from 'vitest';

import { WebDavDataSource } from './webdav-datasource.js';

const BASE_URL = 'http://dav.test/remote.php/dav';

const mockFetch = (status: number): typeof fetch => async () => new Response('', { status });

const makeDatasource = (fetchImpl: typeof fetch) =>
  new WebDavDataSource({ baseUrl: BASE_URL, fetch: fetchImpl }, ['md']);

/** Spy that captures outgoing headers and always responds 200 OK. */
const makeHeaderSpy = () => {
  const calls: Array<Record<string, string>> = [];
  const spy: typeof fetch = async (_url, init) => {
    calls.push((init?.headers ?? {}) as Record<string, string>);
    return new Response('', { status: 200 });
  };
  return { spy, calls };
};

const assertFailure = (result: Result.Result<unknown, unknown>): unknown => {
  if (!Result.isFailure(result)) throw new Error('Expected Result.Failure but got Success');
  return result.failure;
};

describe('WebDavDataSource errorForStatus — auth and rate-limit paths', () => {
  describe('statResource (PROPFIND)', () => {
    it('401 → AuthenticationError', async () => {
      const ds = makeDatasource(mockFetch(401));
      expect(assertFailure(await ds.statResource('docs/page'))).toBeInstanceOf(AuthenticationError);
    });

    it('403 → ForbiddenError', async () => {
      const ds = makeDatasource(mockFetch(403));
      expect(assertFailure(await ds.statResource('docs/page'))).toBeInstanceOf(ForbiddenError);
    });

    it('423 → ConflictError (locked)', async () => {
      const ds = makeDatasource(mockFetch(423));
      const err = assertFailure(await ds.statResource('docs/page'));
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as ConflictError).message).toMatch(/locked/i);
    });

    it('429 → TooManyRequestsError', async () => {
      const ds = makeDatasource(mockFetch(429));
      expect(assertFailure(await ds.statResource('docs/page'))).toBeInstanceOf(TooManyRequestsError);
    });
  });

  describe('readFile (GET)', () => {
    it('401 → AuthenticationError', async () => {
      const ds = makeDatasource(mockFetch(401));
      expect(assertFailure(await ds.readFile('docs/page', 'md'))).toBeInstanceOf(AuthenticationError);
    });

    it('403 → ForbiddenError', async () => {
      const ds = makeDatasource(mockFetch(403));
      expect(assertFailure(await ds.readFile('docs/page', 'md'))).toBeInstanceOf(ForbiddenError);
    });

    it('423 → ConflictError (locked)', async () => {
      const ds = makeDatasource(mockFetch(423));
      expect(assertFailure(await ds.readFile('docs/page', 'md'))).toBeInstanceOf(ConflictError);
    });

    it('429 → TooManyRequestsError', async () => {
      const ds = makeDatasource(mockFetch(429));
      expect(assertFailure(await ds.readFile('docs/page', 'md'))).toBeInstanceOf(TooManyRequestsError);
    });
  });

  describe('writeFile (MKCOL + PUT) — error surfaced from parent collection step', () => {
    it('401 → AuthenticationError', async () => {
      const ds = makeDatasource(mockFetch(401));
      expect(assertFailure(await ds.writeFile('docs/page', 'md', 'content'))).toBeInstanceOf(
        AuthenticationError,
      );
    });

    it('403 → ForbiddenError', async () => {
      const ds = makeDatasource(mockFetch(403));
      expect(assertFailure(await ds.writeFile('docs/page', 'md', 'content'))).toBeInstanceOf(
        ForbiddenError,
      );
    });

    it('423 → ConflictError (locked)', async () => {
      const ds = makeDatasource(mockFetch(423));
      const err = assertFailure(await ds.writeFile('docs/page', 'md', 'content'));
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as ConflictError).message).toMatch(/locked/i);
    });

    it('429 → TooManyRequestsError', async () => {
      const ds = makeDatasource(mockFetch(429));
      expect(assertFailure(await ds.writeFile('docs/page', 'md', 'content'))).toBeInstanceOf(
        TooManyRequestsError,
      );
    });
  });

  describe('deleteResource (DELETE)', () => {
    it('401 → AuthenticationError', async () => {
      const ds = makeDatasource(mockFetch(401));
      expect(assertFailure(await ds.deleteResource('docs/page.md'))).toBeInstanceOf(
        AuthenticationError,
      );
    });

    it('403 → ForbiddenError', async () => {
      const ds = makeDatasource(mockFetch(403));
      expect(assertFailure(await ds.deleteResource('docs/page.md'))).toBeInstanceOf(ForbiddenError);
    });

    it('423 → ConflictError (locked)', async () => {
      const ds = makeDatasource(mockFetch(423));
      const err = assertFailure(await ds.deleteResource('docs/page.md'));
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as ConflictError).message).toMatch(/locked/i);
    });

    it('429 → TooManyRequestsError', async () => {
      const ds = makeDatasource(mockFetch(429));
      expect(assertFailure(await ds.deleteResource('docs/page.md'))).toBeInstanceOf(
        TooManyRequestsError,
      );
    });
  });

  describe('ensureCollection (MKCOL)', () => {
    it('401 → AuthenticationError', async () => {
      const ds = makeDatasource(mockFetch(401));
      expect(assertFailure(await ds.ensureCollection('docs/sub'))).toBeInstanceOf(
        AuthenticationError,
      );
    });

    it('403 → ForbiddenError', async () => {
      const ds = makeDatasource(mockFetch(403));
      expect(assertFailure(await ds.ensureCollection('docs/sub'))).toBeInstanceOf(ForbiddenError);
    });

    it('423 → ConflictError (locked)', async () => {
      const ds = makeDatasource(mockFetch(423));
      const err = assertFailure(await ds.ensureCollection('docs/sub'));
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as ConflictError).message).toMatch(/locked/i);
    });

    it('429 → TooManyRequestsError', async () => {
      const ds = makeDatasource(mockFetch(429));
      expect(assertFailure(await ds.ensureCollection('docs/sub'))).toBeInstanceOf(
        TooManyRequestsError,
      );
    });
  });

  describe('listChildren (PROPFIND Depth:1)', () => {
    it('401 → AuthenticationError', async () => {
      const ds = makeDatasource(mockFetch(401));
      expect(assertFailure(await ds.listChildren('docs'))).toBeInstanceOf(AuthenticationError);
    });

    it('403 → ForbiddenError', async () => {
      const ds = makeDatasource(mockFetch(403));
      expect(assertFailure(await ds.listChildren('docs'))).toBeInstanceOf(ForbiddenError);
    });

    it('423 → ConflictError (locked)', async () => {
      const ds = makeDatasource(mockFetch(423));
      expect(assertFailure(await ds.listChildren('docs'))).toBeInstanceOf(ConflictError);
    });

    it('429 → TooManyRequestsError', async () => {
      const ds = makeDatasource(mockFetch(429));
      expect(assertFailure(await ds.listChildren('docs'))).toBeInstanceOf(TooManyRequestsError);
    });
  });
});

describe('WebDavDataSource buildAuthHeaders — outgoing Authorization headers', () => {
  it('bearer token → Authorization: Bearer <token>', async () => {
    const { spy, calls } = makeHeaderSpy();
    const ds = new WebDavDataSource({ baseUrl: BASE_URL, auth: { token: 'tok-abc' }, fetch: spy });
    await ds.deleteResource('file.md');
    expect(calls).toHaveLength(1);
    expect(calls[0]!['Authorization']).toBe('Bearer tok-abc');
  });

  it('basic auth → Authorization: Basic base64(user:pass)', async () => {
    const { spy, calls } = makeHeaderSpy();
    const ds = new WebDavDataSource({
      baseUrl: BASE_URL,
      auth: { username: 'alice', password: 'secret' },
      fetch: spy,
    });
    await ds.deleteResource('file.md');
    expect(calls).toHaveLength(1);
    const authHeader = calls[0]!['Authorization']!;
    expect(authHeader).toMatch(/^Basic /);
    expect(atob(authHeader.slice('Basic '.length))).toBe('alice:secret');
  });

  it('basic auth with no password → Authorization: Basic base64(user:)', async () => {
    const { spy, calls } = makeHeaderSpy();
    const ds = new WebDavDataSource({
      baseUrl: BASE_URL,
      auth: { username: 'bob' },
      fetch: spy,
    });
    await ds.deleteResource('file.md');
    const authHeader = calls[0]!['Authorization']!;
    expect(authHeader).toMatch(/^Basic /);
    expect(atob(authHeader.slice('Basic '.length))).toBe('bob:');
  });

  it('auth.headers extras are merged into every outgoing request', async () => {
    const { spy, calls } = makeHeaderSpy();
    const ds = new WebDavDataSource({
      baseUrl: BASE_URL,
      auth: { username: 'alice', password: 'pw', headers: { 'OCS-APIRequest': 'true', 'X-Custom': 'val' } },
      fetch: spy,
    });
    await ds.deleteResource('file.md');
    expect(calls[0]!['OCS-APIRequest']).toBe('true');
    expect(calls[0]!['X-Custom']).toBe('val');
  });

  it('auth.headers Authorization is overwritten by bearer token credential', async () => {
    const { spy, calls } = makeHeaderSpy();
    const ds = new WebDavDataSource({
      baseUrl: BASE_URL,
      auth: { token: 'real-token', headers: { 'Authorization': 'should-be-overridden' } },
      fetch: spy,
    });
    await ds.deleteResource('file.md');
    expect(calls[0]!['Authorization']).toBe('Bearer real-token');
  });

  it('auth.headers Authorization is overwritten by basic credentials', async () => {
    const { spy, calls } = makeHeaderSpy();
    const ds = new WebDavDataSource({
      baseUrl: BASE_URL,
      auth: { username: 'alice', password: 'pw', headers: { 'Authorization': 'should-be-overridden' } },
      fetch: spy,
    });
    await ds.deleteResource('file.md');
    const authHeader = calls[0]!['Authorization']!;
    expect(authHeader).toMatch(/^Basic /);
    expect(atob(authHeader.slice('Basic '.length))).toBe('alice:pw');
  });

  it('no auth config → no Authorization header sent', async () => {
    const { spy, calls } = makeHeaderSpy();
    const ds = new WebDavDataSource({ baseUrl: BASE_URL, fetch: spy });
    await ds.deleteResource('file.md');
    expect(calls[0]!['Authorization']).toBeUndefined();
  });

  it('auth headers persist across multiple requests on the same datasource instance', async () => {
    const { spy, calls } = makeHeaderSpy();
    const ds = new WebDavDataSource({
      baseUrl: BASE_URL,
      auth: { token: 'persistent-token' },
      fetch: spy,
    });
    await ds.deleteResource('a.md');
    await ds.deleteResource('b.md');
    expect(calls).toHaveLength(2);
    expect(calls[0]!['Authorization']).toBe('Bearer persistent-token');
    expect(calls[1]!['Authorization']).toBe('Bearer persistent-token');
  });
});

describe('WebDavDataSource — basePath option', () => {
  const BASE_WITH_PATH = 'http://dav.test/remote.php/dav/files/alice';
  const BASE_PATH = 'laika-content';

  const makeUrlSpy = (): { spy: typeof fetch, urls: string[] } => {
    const urls: string[] = [];
    const spy: typeof fetch = async (input, _init) => {
      urls.push(typeof input === 'string' ? input : input.toString());
      return new Response('', { status: 204 });
    };
    return { spy, urls };
  };

  it('outgoing request URL includes basePath segments', async () => {
    const { spy, urls } = makeUrlSpy();
    const ds = new WebDavDataSource({ baseUrl: BASE_WITH_PATH, basePath: BASE_PATH, fetch: spy });
    await ds.deleteResource('docs/post.md');
    expect(urls[0]).toBe(
      'http://dav.test/remote.php/dav/files/alice/laika-content/docs/post.md',
    );
  });

  it('root key maps to basePath root URL with no trailing slash', async () => {
    const { spy, urls } = makeUrlSpy();
    const ds = new WebDavDataSource({ baseUrl: BASE_WITH_PATH, basePath: BASE_PATH, fetch: spy });
    await ds.deleteResource('');
    expect(urls[0]).toBe('http://dav.test/remote.php/dav/files/alice/laika-content');
  });

  it('basePath with leading and trailing slashes is normalised', async () => {
    const { spy, urls } = makeUrlSpy();
    const ds = new WebDavDataSource({
      baseUrl: BASE_WITH_PATH,
      basePath: '/laika-content/',
      fetch: spy,
    });
    await ds.deleteResource('docs/post.md');
    expect(urls[0]).toBe(
      'http://dav.test/remote.php/dav/files/alice/laika-content/docs/post.md',
    );
  });

  it('listChildren strips both baseUrl and basePath segments from server hrefs', async () => {
    const rootHref = '/remote.php/dav/files/alice/laika-content/';
    const childHref = '/remote.php/dav/files/alice/laika-content/docs/post.md';
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>${rootHref}</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
    <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>${childHref}</d:href>
    <d:propstat><d:prop><d:resourcetype></d:resourcetype></d:prop>
    <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
</d:multistatus>`;

    const spy: typeof fetch = async () =>
      new Response(xml, {
        status: 207,
        headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      });

    const ds = new WebDavDataSource({ baseUrl: BASE_WITH_PATH, basePath: BASE_PATH, fetch: spy });
    const result = await ds.listChildren('');

    expect(Result.isFailure(result)).toBe(false);
    if (Result.isFailure(result)) return;
    expect(result.success).toHaveLength(1);
    expect(result.success[0]!.key).toBe('docs/post.md');
  });

  it('hrefs outside the basePath root are silently dropped', async () => {
    // A server-side href that does not start with the basePath prefix
    const outsideHref = '/remote.php/dav/files/bob/other.md';
    const insideHref = '/remote.php/dav/files/alice/laika-content/notes.md';
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>${outsideHref}</d:href>
    <d:propstat><d:prop><d:resourcetype></d:resourcetype></d:prop>
    <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>${insideHref}</d:href>
    <d:propstat><d:prop><d:resourcetype></d:resourcetype></d:prop>
    <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
</d:multistatus>`;

    const spy: typeof fetch = async () =>
      new Response(xml, {
        status: 207,
        headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      });

    const ds = new WebDavDataSource({ baseUrl: BASE_WITH_PATH, basePath: BASE_PATH, fetch: spy });
    const result = await ds.listChildren('');

    expect(Result.isFailure(result)).toBe(false);
    if (Result.isFailure(result)) return;
    // Only the inside href is kept; the outside one is dropped
    expect(result.success).toHaveLength(1);
    expect(result.success[0]!.key).toBe('notes.md');
  });
});
