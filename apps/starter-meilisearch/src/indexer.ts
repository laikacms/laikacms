/**
 * Periodic re-indexer. Polls `laika.documents.listRecords` every INTERVAL,
 * diffs against the last snapshot, and pushes added/changed/removed
 * documents to Meilisearch.
 *
 * For production: replace the polling loop with a real subscription once
 * LaikaCMS gains native pub/sub (ADR-001). The Meilisearch update calls
 * stay the same.
 */
import { MeiliSearch } from 'meilisearch';

import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './laika.js';

const INDEX_NAME = 'posts';
const POLL_MS = 5_000;

export interface PostDoc {
  id: string; // primary key for meili
  key: string;
  slug: string;
  title: string;
  date: string | null;
  body: string;
}

async function buildDoc(key: string): Promise<PostDoc | null> {
  try {
    const doc = await runTask(laika.documents.getDocument(key));
    const content = ((doc as { content?: Record<string, unknown> }).content ?? {}) as Record<
      string,
      unknown
    >;
    const slug = key.replace(/^posts\//, '').replace(/\.md$/, '');
    return {
      id: slug,
      key,
      slug,
      title: (content.title as string) ?? slug,
      date: (content.date as string) ?? null,
      body: (content.body as string) ?? '',
    };
  } catch {
    return null;
  }
}

export async function createMeiliIndexer(client: MeiliSearch): Promise<() => void> {
  // Configure the index once on boot. Idempotent — `getOrCreateIndex` is a
  // typical pattern but isn't in the JS SDK; we do it manually.
  try {
    await client.createIndex(INDEX_NAME, { primaryKey: 'id' });
  } catch {
    /* index already exists — fine */
  }
  const index = client.index<PostDoc>(INDEX_NAME);
  await index.updateSearchableAttributes(['title', 'body', 'slug']);
  await index.updateFilterableAttributes(['date']);

  let prev = new Map<string, string>(); // key → updatedAt

  async function snapshot(): Promise<Map<string, string>> {
    const { items } = await collectStream(
      laika.documents.listRecords({
        folder: 'posts',
        depth: 1,
        pagination: { offset: 0, limit: 1000 },
        type: 'published',
      }),
    );
    const map = new Map<string, string>();
    for (const item of items) {
      if (item.type === 'published') {
        const key = (item as { key: string }).key;
        const updatedAt = (item as { updatedAt?: string }).updatedAt ?? '';
        map.set(key, updatedAt);
      }
    }
    return map;
  }

  // Initial full index — Meilisearch is happy to receive a bulk addDocuments call.
  prev = await snapshot();
  const initialDocs = (await Promise.all([...prev.keys()].map(buildDoc))).filter(
    (d): d is PostDoc => d !== null,
  );
  if (initialDocs.length) await index.addDocuments(initialDocs);

  const handle = setInterval(async () => {
    try {
      const next = await snapshot();
      const toAddOrUpdate: string[] = [];
      const toRemove: string[] = [];
      for (const [key, ts] of next) {
        if (!prev.has(key) || prev.get(key) !== ts) toAddOrUpdate.push(key);
      }
      for (const key of prev.keys()) {
        if (!next.has(key)) toRemove.push(key);
      }
      if (toAddOrUpdate.length) {
        const docs = (await Promise.all(toAddOrUpdate.map(buildDoc))).filter(
          (d): d is PostDoc => d !== null,
        );
        if (docs.length) await index.addDocuments(docs);
      }
      if (toRemove.length) {
        const ids = toRemove.map(k => k.replace(/^posts\//, '').replace(/\.md$/, ''));
        await index.deleteDocuments(ids);
      }
      prev = next;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('meili indexer error:', err);
    }
  }, POLL_MS);

  return () => clearInterval(handle);
}
