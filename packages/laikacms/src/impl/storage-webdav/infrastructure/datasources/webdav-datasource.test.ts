import * as Result from 'effect/Result';
import { AuthenticationError, ConflictError, ForbiddenError, TooManyRequestsError } from 'laikacms/core';
import { describe, expect, it } from 'vitest';

import { WebDavDataSource } from './webdav-datasource.js';

const BASE_URL = 'http://dav.test/remote.php/dav';

const mockFetch = (status: number): typeof fetch => async () => new Response('', { status });

const makeDatasource = (fetchImpl: typeof fetch) =>
  new WebDavDataSource({ baseUrl: BASE_URL, fetch: fetchImpl }, ['md']);

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
