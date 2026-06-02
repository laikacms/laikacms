# `@laikacms/starter-email-digest`

Email digest of new LaikaCMS posts via [Resend](https://resend.com). Subscribers sign up, a
scheduled job sends each one a per-subscriber summary of posts published since their last digest.
Includes one-click unsubscribe.

## Stack

- Hono + `@hono/node-server`
- `resend` SDK
- JSON-file subscriber store (~80 LOC; swap for SQL/KV in production)
- `laikacms` + `@laikacms/decap-integrations/embedded`

## Setup

```bash
cp .env.example .env
# Fill in RESEND_API_KEY (https://resend.com/api-keys) and FROM_EMAIL (must be verified).
pnpm install
pnpm --filter @laikacms/starter-email-digest dev
```

Subscribe:

```bash
curl -X POST http://localhost:3000/subscribe \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}'
```

Send digests (manually for testing):

```bash
pnpm --filter @laikacms/starter-email-digest send-digest
```

## How the digest job works

`src/send-digest.ts`:

1. Read all subscribers from `SUBSCRIBERS_FILE`.
2. For each subscriber, query `laika.documents.listRecords` and filter to posts whose `date` is
   after `subscriber.lastDigestSentAt`.
3. If any are new, render an HTML email with the post list + an unsubscribe URL containing the
   subscriber's token.
4. Send via Resend.
5. Update `subscriber.lastDigestSentAt`.

## Scheduling

Run `send-digest` on whatever cadence you want. Examples:

| Platform           | How                                                    |
| ------------------ | ------------------------------------------------------ |
| `crontab` on a VPS | `0 10 * * 1 cd /path && pnpm send-digest`              |
| Fly.io             | `processes.cron` in `fly.toml`                         |
| Cloudflare Workers | `[triggers] crons = ["0 10 * * 1"]` in `wrangler.toml` |
| Lambda             | EventBridge schedule rule → invoke the Lambda          |
| GitHub Actions     | `schedule:` workflow on a cron expression              |
| Render.com         | Cron Job service in the dashboard                      |

The job is **idempotent per subscriber** — if it crashes mid-batch, re-running picks up where it
left off because `lastDigestSentAt` is updated per-subscriber, not globally.

## Production hardening

1. **DB-backed store.** Swap `SubscriberStore` for SQL (Drizzle, Prisma, raw `pg`). The interface
   stays the same.
2. **Double opt-in.** Send a confirmation email before adding to the active list. Reduces spam
   complaints + bounce rate.
3. **List-Unsubscribe header.** Add `List-Unsubscribe: <https://your-domain/unsubscribe?token=…>` to
   every send — Gmail, iCloud, etc. surface this as a one-click unsubscribe button.
4. **Rate limiting.** Resend caps you at 10/s on the free plan. The starter sends sequentially — add
   `Promise.allSettled` chunks of 10 with a 1s wait between chunks for larger lists.
5. **Bounce handling.** Subscribe to Resend webhooks for `bounce` + `complaint` events; remove
   bouncing addresses from the active list.

## Why this matters

Email is the most direct re-engagement channel for content sites. The starter shows the **whole
loop** — subscribe → query LaikaCMS for what's new per subscriber → send → mark sent — in ~200 LOC.
Swap Resend for **SendGrid / Postmark / SES / Loops** with the same shape.

See [`docs/starters.md`](../../docs/starters.md) and [`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).
