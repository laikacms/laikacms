import { drizzleStorageContractCase } from '../../../impl/storage-drizzle/testing.js';
import { storagefsContractCase } from '../../../impl/storage-fs/testing/index.js';
import { jsonApiProxyStorageContractCase } from '../../../impl/storage-jsonapi-proxy/testing.js';
import { r2StorageContractCase } from '../../../impl/storage-r2/testing.js';
import { webFsStorageContractCase } from '../../../impl/storage-web-fs/testing.js';
import { webStorageContractCase } from '../../../impl/storage-web/testing.js';
import { webDavStorageContractCase } from '../../../impl/storage-webdav/testing.js';
import type { StorageContractCase } from './contract.js';

export const storageContractRegistry: StorageContractCase[] = [
  storagefsContractCase,
  drizzleStorageContractCase,
  webDavStorageContractCase,
  r2StorageContractCase,
  jsonApiProxyStorageContractCase,
  webStorageContractCase,
  webFsStorageContractCase,
];
