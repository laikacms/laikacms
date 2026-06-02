import { storagefsContractCase } from '../../../impl/storage-fs/testing/index.js';
import type { StorageContractCase } from './contract.js';

export const storageContractRegistry: StorageContractCase[] = [
  storagefsContractCase,
];
