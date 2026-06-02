import { Inngest } from 'inngest';

// INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY are set automatically when
// deploying via the Inngest dashboard. For local dev, `npx inngest-cli@latest
// dev` runs a local Inngest server; set INNGEST_DEV_SERVER_URL to point at it.
export const inngest = new Inngest({
  id: 'laika-blog',
  isDev: process.env.NODE_ENV !== 'production',
});

// ── Event shapes ──────────────────────────────────────────────────────────────

export interface PostSavedData {
  key: string;
  method: 'POST' | 'PUT';
  statusCode: number;
}

export interface PostDeletedData {
  key: string;
}

// ── Functions ─────────────────────────────────────────────────────────────────

// Inngest v4: triggers moved into the options object (was a separate second argument in v3)
export const onPostSaved = inngest.createFunction(
  {
    id: 'on-post-saved',
    name: 'On Post Saved',
    triggers: [{ event: 'cms/post.saved' }],
  },
  async ({ event, step }) => {
    const { key, method } = event.data as PostSavedData;
    const action = method === 'POST' ? 'created' : 'updated';

    await step.run('log', async () => {
      // Replace with: rebuild static pages, send Slack notification,
      // update a search index, ping a CDN purge API, etc.
      console.log(`[inngest] post ${action}: ${key}`);
    });

    return { ok: true, key, action };
  },
);

export const onPostDeleted = inngest.createFunction(
  {
    id: 'on-post-deleted',
    name: 'On Post Deleted',
    triggers: [{ event: 'cms/post.deleted' }],
  },
  async ({ event, step }) => {
    const { key } = event.data as PostDeletedData;

    await step.run('log', async () => {
      console.log(`[inngest] post deleted: ${key}`);
    });

    return { ok: true, key };
  },
);
