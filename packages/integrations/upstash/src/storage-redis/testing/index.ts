import type { StorageContractCase } from 'laikacms/storage/testing';

import { UpstashRedisStorageRepository } from '../redis-storage-repository.js';

const URL_BASE = 'https://test.upstash.io';

/** Translate Redis glob (`*`, `?`, `[set]`) into a RegExp. */
const globToRegex = (glob: string): RegExp => {
  let pattern = '^';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') pattern += '.*';
    else if (ch === '?') pattern += '.';
    else if ('[]^$.|()+\\'.includes(ch)) pattern += '\\' + ch;
    else pattern += ch;
  }
  pattern += '$';
  return new RegExp(pattern);
};

const createMockRedis = () => {
  const store = new Map<string, string>();

  const runCommand = (cmd: ReadonlyArray<string | number>): { result?: unknown, error?: string } => {
    const op = String(cmd[0]).toUpperCase();
    switch (op) {
      case 'GET': {
        const k = String(cmd[1]);
        const v = store.get(k);
        return { result: v === undefined ? null : v };
      }
      case 'SET': {
        store.set(String(cmd[1]), String(cmd[2]));
        return { result: 'OK' };
      }
      case 'DEL': {
        let count = 0;
        for (let i = 1; i < cmd.length; i++) {
          if (store.delete(String(cmd[i]))) count += 1;
        }
        return { result: count };
      }
      case 'EXISTS': {
        let count = 0;
        for (let i = 1; i < cmd.length; i++) {
          if (store.has(String(cmd[i]))) count += 1;
        }
        return { result: count };
      }
      case 'SCAN': {
        const matchIdx = cmd.findIndex(x => String(x).toUpperCase() === 'MATCH');
        const pattern = matchIdx >= 0 ? String(cmd[matchIdx + 1]) : '*';
        const re = globToRegex(pattern);
        const keys = [...store.keys()].filter(k => re.test(k));
        return { result: ['0', keys] };
      }
      default:
        return { error: `unsupported command: ${op}` };
    }
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const body = init?.body ? JSON.parse(init.body as string) : [];

    if (url.pathname === '/pipeline') {
      const commands = body as ReadonlyArray<readonly (string | number)[]>;
      const results = commands.map(runCommand);
      return new Response(JSON.stringify(results), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const result = runCommand(body as readonly (string | number)[]);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return { store, fetch: fetchImpl };
};

const makeSerializerRegistry = () => ({
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as unknown,
  },
});

export const upstashRedisContractCase: StorageContractCase = {
  name: 'UpstashRedisStorageRepository',
  makeRepo() {
    const redis = createMockRedis();
    return new UpstashRedisStorageRepository({
      url: URL_BASE,
      token: 'fake-token',
      fetch: redis.fetch,
      namespace: 'laika:storage',
      serializerRegistry: makeSerializerRegistry(),
      defaultFileExtension: 'json',
    });
  },
};
