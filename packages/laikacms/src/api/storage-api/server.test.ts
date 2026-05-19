import { describe, expect, it } from 'vitest';
import type { StorageRepository } from 'laikacms/storage';
import { buildJsonApi } from './server.js';

// The handler only consults `repo` for non-root endpoints. For Cache-Control
// regression tests we hit the root + a 404, neither of which touch the repo,
// so a placeholder cast is enough.
const stubRepo = {} as StorageRepository;

describe('storage-api Cache-Control', () => {
  it('sends Cache-Control: no-store on the root API info response', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(new Request('http://localhost/'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('sends Cache-Control: no-store on 404 responses', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(new Request('http://localhost/does-not-exist'));
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
