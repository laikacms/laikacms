---
title: Hello from the email digest
date: 2026-05-31T10:00:00.000Z
---

Subscribe an email via `POST /subscribe`. Then run
`pnpm --filter @laikacms/starter-email-digest send-digest` (or wire it to a cron). Each subscriber
receives an email listing posts published since their last digest, with an unsubscribe link in the
footer.
