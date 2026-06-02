#!/usr/bin/env -S node --import tsx
/**
 * Scheduled digest sender. Intended to be invoked by a cron / scheduled
 * task (Fly Machines cron, Cloudflare Workers cron triggers, GitHub
 * Actions schedule, plain crontab, etc.).
 *
 * For each subscriber:
 *   1. Find published posts created after `lastDigestSentAt`.
 *   2. If there are any, send one email with a list of them.
 *   3. Update `lastDigestSentAt`.
 *
 * Run manually:
 *   pnpm --filter @laikacms/starter-email-digest send-digest
 *
 * On Fly: add to fly.toml as a `processes.cron` entry; on CF Workers:
 * `crons = ["0 10 * * 1"]` (Mondays at 10 UTC); on Lambda: EventBridge rule.
 */
import { Resend } from 'resend';

import { collectStream } from 'laikacms/compat';

import { laika } from './laika.js';
import { createSubscriberStore } from './subscribers.js';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL;
const PUBLIC_URL = process.env.PUBLIC_URL ?? 'http://localhost:3000';

if (!RESEND_API_KEY || !FROM_EMAIL) {
  // eslint-disable-next-line no-console
  console.error('Missing RESEND_API_KEY or FROM_EMAIL — refusing to send.');
  process.exit(1);
}

const resend = new Resend(RESEND_API_KEY);
const store = createSubscriberStore();

async function recentPosts(since: string | null) {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 500 },
      type: 'published',
    }),
  );
  return items
    .filter(i => i.type === 'published')
    .map(item => {
      const content = ((item as { content?: Record<string, unknown> }).content ?? {}) as Record<
        string,
        unknown
      >;
      const key = (item as { key: string }).key;
      return {
        slug: key.replace(/^posts\//, '').replace(/\.md$/, ''),
        title: (content.title as string) ?? key,
        date: (content.date as string) ?? (item as { updatedAt?: string }).updatedAt ?? null,
      };
    })
    .filter(p => !since || (p.date && p.date > since))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

function renderHtml(posts: Awaited<ReturnType<typeof recentPosts>>, unsubscribeUrl: string): string {
  const items = posts
    .map(
      p =>
        `<li style="margin-bottom: 1rem;">
        <a href="${PUBLIC_URL}/posts/${p.slug}">${escapeHtml(p.title)}</a>
        ${p.date ? `<br><small>${new Date(p.date).toDateString()}</small>` : ''}
      </li>`,
    )
    .join('\n');
  return `<!doctype html><html><body style="font-family: system-ui;">
    <h2>New posts since your last digest</h2>
    <ul style="list-style: none; padding: 0;">${items}</ul>
    <hr>
    <p style="font-size: 0.8em; color: #666;">
      Not interested? <a href="${unsubscribeUrl}">Unsubscribe here</a>.
    </p>
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function main() {
  const subscribers = await store.list();
  let sent = 0;
  for (const sub of subscribers) {
    const posts = await recentPosts(sub.lastDigestSentAt);
    if (posts.length === 0) continue;
    const unsubscribeUrl = `${PUBLIC_URL}/unsubscribe?token=${sub.unsubscribeToken}`;
    try {
      await resend.emails.send({
        from: FROM_EMAIL!,
        to: sub.email,
        subject: `${posts.length} new post${posts.length === 1 ? '' : 's'} since your last digest`,
        html: renderHtml(posts, unsubscribeUrl),
      });
      await store.markSent(sub.email, new Date().toISOString());
      sent++;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`failed to send to ${sub.email}:`, err);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`digest run: ${sent} sent / ${subscribers.length} subscribers`);
}

await main();
