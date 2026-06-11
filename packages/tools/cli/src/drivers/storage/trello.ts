import type { StorageRepository } from 'laikacms/storage';

import { defaultSerializerRegistry } from '../serializers.js';
import type { StorageDriver } from '../types.js';

interface TrelloOptions {
  readonly apiKey: string;
  readonly token: string;
  readonly boardId: string;
  readonly defaultExtension: string;
  readonly apiUrl?: string;
}

const readOptions = (raw: Record<string, unknown>): TrelloOptions => {
  const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey : process.env.TRELLO_API_KEY;
  const token = typeof raw.token === 'string' ? raw.token : process.env.TRELLO_TOKEN;
  const boardId = raw.boardId;
  if (!apiKey) {
    throw new Error('trello driver: "apiKey" is required (or set TRELLO_API_KEY)');
  }
  if (!token) {
    throw new Error('trello driver: "token" is required (or set TRELLO_TOKEN)');
  }
  if (typeof boardId !== 'string' || boardId.length === 0) {
    throw new Error('trello driver: "boardId" is required');
  }
  return {
    apiKey,
    token,
    boardId,
    defaultExtension: typeof raw.defaultExtension === 'string' ? raw.defaultExtension : 'md',
    apiUrl: typeof raw.apiUrl === 'string' ? raw.apiUrl : undefined,
  };
};

export const trelloDriver: StorageDriver = {
  name: 'trello',
  packageName: '@laikacms/trello',
  version: '1.0.0',
  subpath: 'storage-trello',
  description: 'Trello board (lists become folders, cards become objects)',
  build(raw, mod) {
    const options = readOptions(raw);
    const DataSourceCtor = mod.TrelloDataSource as new(o: {
      auth: { apiKey: string, token: string },
      boardId: string,
      apiUrl?: string,
    }) => unknown;
    const dataSource = new DataSourceCtor({
      auth: { apiKey: options.apiKey, token: options.token },
      boardId: options.boardId,
      apiUrl: options.apiUrl,
    });
    const Ctor = mod.TrelloStorageRepository as new(o: {
      dataSource: unknown,
      serializerRegistry: typeof defaultSerializerRegistry,
      defaultFileExtension: string,
    }) => StorageRepository;
    return new Ctor({
      dataSource,
      serializerRegistry: defaultSerializerRegistry,
      defaultFileExtension: options.defaultExtension,
    });
  },
};
