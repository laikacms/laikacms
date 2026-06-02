#!/usr/bin/env -S node --import tsx
/**
 * LaikaCMS content migration script.
 *
 * Demonstrates how to batch-transform published documents using:
 *   - collectStream + listRecordSummaries  to iterate the collection
 *   - getDocument                          to read each document
 *   - createRevision                       to snapshot before changing (optional --no-backup)
 *   - updateDocument                       to write the transformed content back
 *
 * This specific migration adds an `excerpt` field to every post that does not
 * already have one by extracting the first 200 characters from `body`.
 *
 * Usage:
 *   pnpm migrate                  — dry-run (prints what would change)
 *   pnpm migrate --apply          — apply changes
 *   pnpm migrate --apply --no-backup  — apply without creating revision snapshots
 *   pnpm migrate --folder=docs    — target a different folder
 */

import { createEmbeddedLaika, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';
import { resolve } from 'node:path';

// ── Flags ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const DRY_RUN = !argv.includes('--apply');
const BACKUP = !argv.includes('--no-backup');
const folderFlag = argv.find(a => a.startsWith('--folder='));
const FOLDER = folderFlag ? folderFlag.split('=')[1]! : 'posts';

// ── Setup ─────────────────────────────────────────────────────────────────────

const contentDir = resolve(process.cwd(), process.env.LAIKA_CONTENT_DIR ?? 'content');

const laika = createEmbeddedLaika({
  contentDir,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig: minimalBlogConfig(),
});

// ── Transform ─────────────────────────────────────────────────────────────────

function deriveExcerpt(body: string): string {
  const plain = body
    .replace(/#+\s/g, '')
    .replace(/\*\*?([^*]+)\*\*?/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n+/g, ' ')
    .trim();
  return plain.length > 200 ? `${plain.slice(0, 197)}…` : plain;
}

function needsMigration(content: Record<string, unknown>): boolean {
  return !content.excerpt && typeof content.body === 'string' && content.body.trim().length > 0;
}

function transform(content: Record<string, unknown>): Record<string, unknown> {
  return {
    ...content,
    excerpt: deriveExcerpt(content.body as string),
  };
}

// ── Migration loop ────────────────────────────────────────────────────────────

async function migrate(): Promise<void> {
  console.log(`Mode:    ${DRY_RUN ? 'DRY RUN (pass --apply to write)' : 'APPLY'}`);
  console.log(`Folder:  ${FOLDER}`);
  console.log(`Backup:  ${BACKUP ? 'yes (createRevision before each change)' : 'no'}`);
  console.log('');

  const { items } = await collectStream(
    laika.documents.listRecordSummaries({
      folder: FOLDER,
      depth: 1,
      pagination: { page: 1, perPage: 1000 },
      type: 'published',
    }),
  );

  type Summary = { key: string, type: string };
  const keys = (items as Summary[])
    .filter(r => r.type === 'published-summary')
    .map(r => r.key);

  console.log(`Found ${keys.length} published document(s) in '${FOLDER}'.`);
  console.log('');

  let skipped = 0;
  let migrated = 0;
  let failed = 0;

  for (const key of keys) {
    let doc;
    try {
      doc = await runTask(laika.documents.getDocument(key));
    } catch (err) {
      if (err instanceof NotFoundError) {
        console.warn(`  SKIP  ${key} — not found (may have been deleted)`);
        skipped++;
        continue;
      }
      throw err;
    }

    const content = doc.content as Record<string, unknown>;

    if (!needsMigration(content)) {
      console.log(`  skip  ${key} — already has excerpt`);
      skipped++;
      continue;
    }

    const updated = transform(content);
    const excerptPreview = String(updated.excerpt).slice(0, 60);
    console.log(`  migrate  ${key}`);
    console.log(`           excerpt: "${excerptPreview}…"`);

    if (DRY_RUN) continue;

    // Snapshot before changing so the change is reversible.
    if (BACKUP) {
      const revisionId = `pre-migration-${Date.now()}`;
      try {
        await runTask(
          laika.documents.createRevision({
            key,
            type: 'revision',
            revision: revisionId,
            language: doc.language ?? 'en',
            content,
          }),
        );
        console.log(`           revision: ${revisionId}`);
      } catch {
        console.warn(`           revision failed — proceeding anyway`);
      }
    }

    try {
      await runTask(laika.documents.updateDocument({ key, content: updated }));
      migrated++;
    } catch (err) {
      console.error(`  ERROR ${key}:`, err);
      failed++;
    }
  }

  console.log('');
  console.log('─'.repeat(50));
  console.log(`Done.  migrated=${migrated}  skipped=${skipped}  failed=${failed}`);
  if (DRY_RUN) {
    console.log('');
    console.log('This was a dry run. Re-run with --apply to write changes.');
  }
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});
