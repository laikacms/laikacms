# `@laikacms/starter-comments`

Built-in **moderated comments** backed by LaikaCMS records. Two collections (`posts` + `comments`)
in one Decap config; the moderation queue lives next to the regular content. Per-IP rate-limited
submissions, bearer-token-guarded admin endpoints.

## Stack

- Hono + `@hono/node-server`
- `laikacms` + `@laikacms/decap-integrations/embedded`
- In-memory token-bucket rate limit (swap for Redis in production)
- Zero external services

## Setup

```bash
cp .env.example .env
# Generate an admin token: openssl rand -hex 32
pnpm install
pnpm --filter @laikacms/starter-comments dev
```

## API

| Endpoint                             | Auth   | Description                                  |
| ------------------------------------ | ------ | -------------------------------------------- |
| `POST /comments`                     | none   | Submit a comment (goes to `pending` queue)   |
| `GET /comments/:postSlug`            | none   | List **approved** comments only              |
| `GET /admin/comments?status=pending` | bearer | List comments by status                      |
| `POST /admin/comments/:id/approve`   | bearer | Approve                                      |
| `POST /admin/comments/:id/reject`    | bearer | Reject (kept in record store as audit trail) |
| `DELETE /admin/comments/:id`         | bearer | Hard delete                                  |
| `GET /admin`                         | none   | Decap admin shell (also exposes the queue)   |

## Full moderation flow

```bash
# 1. Visitor submits
curl -X POST http://localhost:3000/comments \
  -H "Content-Type: application/json" \
  -d '{"postSlug":"hello-world","author":"Alice","body":"Great post!"}'
# {"id":"a3f9...","status":"pending","message":"awaiting moderation"}

# 2. Moderator sees the queue
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/comments?status=pending

# 3. Approve
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/comments/a3f9.../approve

# 4. Now visible publicly
curl http://localhost:3000/comments/hello-world
```

## Why this is interesting

This starter demonstrates that **LaikaCMS is not just for blog posts** — it's a general record
store. The same content layer that holds `posts/*.md` also holds `comments/*.md`. Moderators can
review pending comments **right in the Decap admin UI** (they appear under the "Comments"
collection) without a separate dashboard.

Trade-off: writing to disk on every comment submission means this scales to ~thousands of comments
per post, not millions. For high-volume use cases, swap the storage repository for the SQL adapter
via `createCustomLaika` — same API, different write path.

## Rate limiting

In-memory token bucket (5 comments / IP / 5 min). For a real deployment behind a load balancer, swap
`createRateLimit` for a Redis-backed limiter (`rate-limiter-flexible`) so the count is shared across
instances.

## Anti-spam suggestions (not included)

- Honeypot field: add a hidden form field; reject submissions where it's non-empty.
- hCaptcha / Turnstile on the client.
- LLM-based moderation: call a small model to classify pending comments before they hit the queue —
  borderline ones go to human review.

## See also

- [`docs/starters.md`](../../docs/starters.md)
- [`../../LLM-GUIDE.md`](../../LLM-GUIDE.md)
- [`apps/starter-webhooks`](../starter-webhooks/) — wire "comment approved" to an outbound webhook
  to notify Slack
