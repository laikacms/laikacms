import { runStorageRepositoryContract } from 'laikacms/storage/testing';
import { InMemoryStorageRepository } from './in-memory-storage-repository.js';

runStorageRepositoryContract({
  name: 'InMemoryStorageRepository',
  makeRepo: () => new InMemoryStorageRepository(),
});
