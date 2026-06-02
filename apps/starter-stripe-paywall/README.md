# `@laikacms/starter-stripe-paywall`

LaikaCMS posts with a **Stripe-powered paywall**: free preview for visitors, full body for
subscribers. Stripe Checkout for signup, webhook to verify, signed cookie to mark a session as
subscribed.

Real-world monetization pattern for newsletter-style content sites.

## Stack

- Hono + `@hono/node-server`
- `stripe` SDK (v17+ — server only)
- Signed-cookie session in `src/session.ts` (~50 LOC, zero deps)
- `laikacms` + `@laikacms/decap-integrations/embedded`

## Setup

1. **Stripe test mode.** Grab the **test** secret key from
   <https://dashboard.stripe.com/test/apikeys>.
2. **Create a recurring price.** Stripe Dashboard → Products → New product → Add a recurring price.
   Copy the `price_…` ID.
3. **`cp .env.example .env`** and fill in `STRIPE_SECRET_KEY` + `STRIPE_PRICE_ID`.
4. **Webhook secret.** In a separate terminal:
   ```bash
   stripe listen --forward-to localhost:3000/stripe/webhook
   ```
   Copy the `whsec_…` it prints into `STRIPE_WEBHOOK_SECRET`.
5. **Session secret.** `openssl rand -hex 32` → paste into `SESSION_SECRET`.

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-stripe-paywall dev
```

Then:

```bash
# As a visitor — get the preview
curl http://localhost:3000/posts/hello-world
# → { preview: "...first 280 chars...", paywalled: true, subscribed: false, subscribeUrl: ... }

# Open the subscribe flow in a browser
open http://localhost:3000/subscribe

# Use Stripe's test card: 4242 4242 4242 4242 (any future expiry + CVC).
# After redirect, the cookie is set; subsequent GETs of the same post
# include the full body.
```

## How the flow works

```
visitor → GET /posts/x        → preview only
visitor → POST /subscribe      → 303 → stripe.checkout.url
   ↓ user fills checkout form
stripe → 303 → /subscribe/success?session_id=cs_…
   → server fetches the Checkout session, verifies payment, sets a signed cookie
visitor (now subscriber) → GET /posts/x → full body
```

The Stripe webhook is **not** how the cookie gets set in the demo — the `/subscribe/success`
redirect handler does it directly. The webhook is the right place to persist subscription state to a
DB so it survives across devices and cookie loss.

## Production hardening

1. **Persist subscriptions** — match Stripe `customer.id` ↔ your user ID in a DB. Look up on every
   request rather than trusting the cookie alone.
2. **Handle `customer.subscription.deleted`** in the webhook to revoke access when subscribers
   cancel.
3. **`getCookie`/`setCookie` from `hono/cookie`** with `__Host-` prefix + `Secure: true` in
   production.
4. **Rotate `SESSION_SECRET`** by accepting two secrets at once — sign with the new, accept the old
   until cookies roll over.
5. **Customer portal.** Add `/manage` that calls
   `stripe.billingPortal.sessions.create({ customer, return_url })` so subscribers can update
   payment methods + cancel themselves.

## Why this matters

Content monetization is one of the most-requested LaikaCMS use cases. The starter shows the full
loop — Checkout → webhook → cookie → per-request paywall check — in ~150 LOC. Swap Stripe for Lemon
Squeezy / Paddle / Polar.sh with the same shape; the LaikaCMS side doesn't care.

See [`docs/starters.md`](../../docs/starters.md) and [`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).
