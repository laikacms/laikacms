import type { AssetsRepository } from 'laikacms/assets';
import { describe, expect, it } from 'vitest';
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
