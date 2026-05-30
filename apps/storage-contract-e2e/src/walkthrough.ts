import { collectStream, runTask } from 'laikacms/compat';
import { InMemoryStorageRepository } from './in-memory-storage-repository.js';

/**
 * CRUDL walkthrough demonstrating the StorageRepository contract using
 * the in-memory faked backend.
 *
 * Run with: `node --import tsx/esm src/walkthrough.ts`
 */
export async function runWalkthrough(): Promise<void> {
  const repo = new InMemoryStorageRepository();

  // Create
  const created = await runTask(
    repo.createObject({ key: 'demo/hello.json', type: 'object', content: { greeting: 'world' } }),
  );
  console.log('Created:', created.key, created.content);

  // Read
  const fetched = await runTask(repo.getObject('demo/hello.json'));
  console.log('Fetched:', fetched.content);

  // Update
  const updated = await runTask(
    repo.updateObject({ key: 'demo/hello.json', content: { greeting: 'updated' } }),
  );
  console.log('Updated:', updated.content);

  // List
  const { items } = await collectStream(
    repo.listAtomSummaries('demo', { depth: 1, pagination: { offset: 0, limit: 100 } }),
  );
  console.log('Listed:', items.map(i => i.key));

  // Delete
  const { done } = await collectStream(repo.removeAtoms(['demo/hello.json']));
  console.log('Removed:', done.removed);
}

// Allow direct execution
runWalkthrough().catch(err => {
  console.error(err);
  process.exit(1);
});
