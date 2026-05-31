#!/usr/bin/env -S node --import tsx
/**
 * Tiny LaikaCMS CLI. Demonstrates that the LaikaCMS API works just as well
 * from a Node.js script as from a web server — no framework required.
 *
 * Commands:
 *   laika list [folder]            — list published documents in a folder
 *   laika get <key>                — print a single document as JSON
 *   laika add <key> [--title=…]    — create an unpublished document (reads body from stdin)
 *   laika publish <key>            — flip an unpublished document to published
 *   laika delete <key>             — delete a published document
 *
 * Set `LAIKA_CONTENT_DIR` to override the default `./content` location.
 */
import { resolve } from 'node:path';
import { stdin } from 'node:process';

import { createEmbeddedLaika, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

const args = process.argv.slice(2);
const [command, ...rest] = args;

const contentDir = resolve(process.cwd(), process.env.LAIKA_CONTENT_DIR ?? 'content');
const laika = createEmbeddedLaika({
  contentDir,
  decapConfig: minimalBlogConfig(),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function parseFlags(parts: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const part of parts) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(part);
    if (match) flags[match[1]!] = match[2] ?? 'true';
  }
  return flags;
}

function usage(): never {
  // eslint-disable-next-line no-console
  console.error('Usage: laika <list|get|add|publish|delete> [args]');
  process.exit(2);
}

async function cmdList(folder = 'posts'): Promise<void> {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder,
      depth: 1,
      pagination: { offset: 0, limit: 1000 },
      type: 'published',
    }),
  );
  for (const item of items.filter(i => i.type === 'published')) {
    const content = ((item as { content?: Record<string, unknown> }).content ?? {}) as Record<
      string,
      unknown
    >;
    const title = (content.title as string) ?? (item as { key: string }).key;
    // eslint-disable-next-line no-console
    console.log(`${(item as { key: string }).key}\t${title}`);
  }
}

async function cmdGet(key?: string): Promise<void> {
  if (!key) usage();
  const doc = await runTask(laika.documents.getDocument(key));
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(doc, null, 2));
}

async function cmdAdd(key?: string, flags: Record<string, string> = {}): Promise<void> {
  if (!key) usage();
  const title = flags.title ?? key.split('/').pop() ?? key;
  const body = await readStdin();
  const created = await runTask(
    laika.documents.createUnpublished({
      key,
      status: 'draft',
      language: 'en' as never,
      content: { title, body, date: new Date().toISOString() } as never,
    } as never),
  );
  // eslint-disable-next-line no-console
  console.log(`created unpublished ${(created as { key: string }).key}`);
}

async function cmdPublish(key?: string): Promise<void> {
  if (!key) usage();
  const published = await runTask(laika.documents.publish(key));
  // eslint-disable-next-line no-console
  console.log(`published ${(published as { key: string }).key}`);
}

async function cmdDelete(key?: string): Promise<void> {
  if (!key) usage();
  try {
    await runTask(laika.documents.deleteDocument(key));
    // eslint-disable-next-line no-console
    console.log(`deleted ${key}`);
  } catch (err) {
    if (err instanceof NotFoundError) {
      // eslint-disable-next-line no-console
      console.error(`not found: ${key}`);
      process.exit(1);
    }
    throw err;
  }
}

const flags = parseFlags(rest.filter(p => p.startsWith('--')));
const positional = rest.filter(p => !p.startsWith('--'));

switch (command) {
  case 'list':
    await cmdList(positional[0]);
    break;
  case 'get':
    await cmdGet(positional[0]);
    break;
  case 'add':
    await cmdAdd(positional[0], flags);
    break;
  case 'publish':
    await cmdPublish(positional[0]);
    break;
  case 'delete':
    await cmdDelete(positional[0]);
    break;
  default:
    usage();
}
