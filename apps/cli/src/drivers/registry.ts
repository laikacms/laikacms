import type { StorageRepository } from 'laikacms/storage';

import { resolveBackendPackage, type ResolveOptions } from './install.js';
import { bitbucketDriver } from './storage/bitbucket.js';
import { fsDriver } from './storage/fs.js';
import { githubCdnDriver } from './storage/github-cdn.js';
import { githubDriver } from './storage/github.js';
import { gitlabDriver } from './storage/gitlab.js';
import { jsonApiProxyDriver } from './storage/jsonapi-proxy.js';
import { s3Driver } from './storage/s3.js';
import { webdavDriver } from './storage/webdav.js';
import type { StorageDriver } from './types.js';

/**
 * All storage drivers known to this CLI, keyed by their short name. The base
 * helper looks the source/destination driver up here at migrate-time. Adding a
 * new backend is a matter of dropping another `StorageDriver` into this array.
 *
 * Built-in drivers (`packageName === 'laikacms'`) always resolve and never
 * prompt to install. The rest lazy-load their npm package on first use.
 */
export const storageDrivers: ReadonlyArray<StorageDriver> = [
  fsDriver,
  jsonApiProxyDriver,
  webdavDriver,
  githubCdnDriver,
  s3Driver,
  githubDriver,
  gitlabDriver,
  bitbucketDriver,
];

const driversByName = new Map(storageDrivers.map(d => [d.name, d]));

export const getStorageDriver = (name: string): StorageDriver => {
  const driver = driversByName.get(name);
  if (!driver) {
    const available = storageDrivers.map(d => d.name).sort().join(', ');
    throw new Error(`laikacli: unknown storage backend "${name}". Available: ${available}`);
  }
  return driver;
};

/**
 * Resolve a driver's package (auto-installing into the cache if needed) and
 * build a {@link StorageRepository} from the given options blob.
 *
 * Built-in drivers (those that ship inside `laikacms`) skip the dynamic
 * resolution path — their constructors are bundled in via static imports at
 * driver-module load time. Only third-party drivers go through
 * {@link resolveBackendPackage} and the on-demand install dance.
 */
export const buildStorageRepository = async (
  driverName: string,
  options: Record<string, unknown>,
  resolveOptions: ResolveOptions = {},
): Promise<StorageRepository> => {
  const driver = getStorageDriver(driverName);
  if (driver.packageName === 'laikacms') {
    return driver.build(options, {});
  }
  const mod = await resolveBackendPackage(
    driver.packageName,
    driver.subpath,
    driver.version,
    resolveOptions,
  );
  return driver.build(options, mod);
};
