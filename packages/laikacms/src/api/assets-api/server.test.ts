import * as Effect from 'effect/Effect';
import type { AssetsRepository, ListResourcesDone, ListResourcesOptions, Resource } from 'laikacms/assets';
import { describe, expect, it } from 'vitest';

import { ForbiddenError, InvalidData, LaikaStream, LaikaTask } from 'laikacms/core';

import { buildAssetsApi } from './server.js';

const stubRepo = {} as AssetsRepository;

describe('assets-api Cache-Control', () => {
  it('sends Cache-Control: no-store on 404 responses', async () => {
    const api = buildAssetsApi({ repository: stubRepo });
    const res = await api.fetch(new Request('http://localhost/api/assets/does-not-exist'));
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('assets-api meta.warnings', () => {
  it('surfaces recoverableErrors from listResources into the response meta.warnings', async () => {
    const partialRepo = {
      listResources: (_folderKey: string, _options: ListResourcesOptions) =>
        LaikaStream.make<Resource, ListResourcesDone>(emit =>
          Effect.gen(function*() {
            yield* emit.data({
              type: 'folder',
              key: 'visible',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            });
            yield* emit.recoverableError(new ForbiddenError('forbidden/: permission denied'));
            return { total: 1 };
          })
        ),
    } as unknown as AssetsRepository;

    const api = buildAssetsApi({ repository: partialRepo });
    const res = await api.fetch(new Request('http://localhost/api/assets/resources'));
    expect(res.status).toBe(200);

    const body = await res.json() as {
      data: Array<{ id: string }>,
      meta?: { warnings?: Array<{ code: string, detail: string }> },
    };

    expect(body.data.map(d => d.id)).toEqual(['visible']);
    expect(body.meta?.warnings).toHaveLength(1);
    expect(body.meta?.warnings?.[0]?.code).toBe('forbidden');
    expect(body.meta?.warnings?.[0]?.detail).toContain('forbidden/');
  });

  it('returns 200 + meta.warnings on a delete that emits a recoverable warning', async () => {
    const partialRepo = {
      // First the route does a lookup to determine type.
      getResource: (key: string) =>
        LaikaTask.make<ReadonlyArray<Resource>>(() =>
          Effect.succeed([{
            type: 'asset' as const,
            key,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            content: { size: 4, etag: 'e' } as Resource['content'],
          }])
        ),
      deleteAsset: (_key: string) =>
        LaikaTask.make<void>(emit =>
          Effect.gen(function*() {
            yield* emit.recoverableError(new InvalidData('orphan thumbnail left behind'));
            return undefined;
          })
        ),
    } as unknown as AssetsRepository;

    const api = buildAssetsApi({ repository: partialRepo });
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources/pic.png', { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as {
      meta: { deleted: boolean, warnings?: Array<{ code: string, detail: string }> },
    };

    expect(body.meta.deleted).toBe(true);
    expect(body.meta.warnings).toHaveLength(1);
    expect(body.meta.warnings?.[0]?.detail).toContain('orphan thumbnail');
  });

  it('still returns 204 No Content on a clean delete with no warnings', async () => {
    const partialRepo = {
      getResource: (key: string) =>
        LaikaTask.make<ReadonlyArray<Resource>>(() =>
          Effect.succeed([{
            type: 'asset' as const,
            key,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            content: { size: 4, etag: 'e' } as Resource['content'],
          }])
        ),
      deleteAsset: (_key: string) => LaikaTask.succeed(undefined),
    } as unknown as AssetsRepository;

    const api = buildAssetsApi({ repository: partialRepo });
    const res = await api.fetch(
      new Request('http://localhost/api/assets/resources/pic.png', { method: 'DELETE' }),
    );
    expect(res.status).toBe(204);
  });
});
