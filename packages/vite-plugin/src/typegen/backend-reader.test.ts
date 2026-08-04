import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the backend contract so this test verifies createBackendReader's
// forwarding independently of backend.ts's real implementation.
const listKeys = vi.fn(async (_repos: unknown, namespace: string) => [`${namespace}/x`]);
const readItem = vi.fn(async (_repos: unknown, id: { namespace: string, key: string }) => ({
  content: { title: id.key },
  meta: { key: id.key },
}));

vi.mock('../backend.js', () => ({ listKeys, readItem }));

// Imported after the mock is registered.
const { createBackendReader } = await import('./orchestrator.js');

beforeEach(() => {
  listKeys.mockClear();
  readItem.mockClear();
});

describe('createBackendReader', () => {
  it('forwards listKeys and readItem to backend.ts', async () => {
    const repos = { marker: true } as never;
    const reader = createBackendReader(repos);

    expect(await reader.listKeys('doc')).toEqual(['doc/x']);
    expect(listKeys).toHaveBeenCalledWith(repos, 'doc');

    expect(await reader.readItem({ namespace: 'doc', key: 'posts/a' })).toEqual({
      content: { title: 'posts/a' },
      meta: { key: 'posts/a' },
    });
    expect(readItem).toHaveBeenCalledWith(repos, { namespace: 'doc', key: 'posts/a' });
  });
});
