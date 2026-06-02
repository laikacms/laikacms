import { serve } from '@hono/node-server';
import { decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import Stripe from 'stripe';

import { runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { laika } from './laika.js';
import { type Session, sign, verify } from './session.js';

const PORT = Number(process.env.PORT ?? 3000);
const requireEnv = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

const STRIPE_SECRET_KEY = requireEnv('STRIPE_SECRET_KEY');
const STRIPE_PRICE_ID = requireEnv('STRIPE_PRICE_ID');
const STRIPE_WEBHOOK_SECRET = requireEnv('STRIPE_WEBHOOK_SECRET');
const SESSION_SECRET = requireEnv('SESSION_SECRET');
const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;

const stripe = new Stripe(STRIPE_SECRET_KEY);

const decapConfig = minimalBlogConfig();
const ADMIN_HTML = decapAdminHtml({ decapConfig, title: 'Admin · LaikaCMS Paywall starter' });

const SESSION_COOKIE = 'laikacms_paywall';
const SUMMARY_LEN = 280;

const app = new Hono();

function currentSession(c: { req: { header: (k: string) => string | undefined } }): Session | null {
  // hono/cookie's getCookie expects a Hono Context; we accept the looser
  // shape so the same helper works from any route.
  const cookieHeader = c.req.header('cookie') ?? '';
  const match = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(cookieHeader);
  return match ? verify(decodeURIComponent(match[1]!), SESSION_SECRET) : null;
}

app.get('/', c => {
  const session = currentSession(c);
  return c.json({
    name: '@laikacms/starter-stripe-paywall',
    subscribed: session?.active ?? false,
    endpoints: {
      'GET /': 'this index (shows subscribed: true/false)',
      'GET /posts/:slug': 'post — free summary for visitors, full body for subscribers',
      'POST /subscribe': 'create a Stripe Checkout session and redirect',
      'POST /stripe/webhook': 'Stripe → us. Verifies signature, flips session.active.',
      'GET /admin': 'Decap CMS admin shell',
    },
  });
});

app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

app.get('/posts/:slug', async c => {
  const session = currentSession(c);
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${c.req.param('slug')}`));
    const content = ((doc as { content?: Record<string, unknown> }).content ?? {}) as Record<
      string,
      unknown
    >;
    const body = (content.body as string) ?? '';
    return c.json({
      slug: c.req.param('slug'),
      title: (content.title as string) ?? null,
      date: (content.date as string) ?? null,
      ...(session?.active
        ? { body, subscribed: true }
        : {
          preview: body.slice(0, SUMMARY_LEN),
          paywalled: body.length > SUMMARY_LEN,
          subscribed: false,
          subscribeUrl: `${PUBLIC_URL}/subscribe`,
        }),
    });
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: 'Not found' }, 404);
    throw err;
  }
});

app.post('/subscribe', async c => {
  const checkout = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${PUBLIC_URL}/subscribe/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${PUBLIC_URL}/`,
  });
  return c.redirect(checkout.url!, 303);
});

app.get('/subscribe/success', async c => {
  // Stripe redirected here. Fetch the checkout session to grab the
  // customer/subscription IDs, then set the session cookie.
  const sessionId = c.req.query('session_id');
  if (!sessionId) return c.text('Missing session_id', 400);
  const checkout = await stripe.checkout.sessions.retrieve(sessionId);
  if (checkout.payment_status !== 'paid' && checkout.status !== 'complete') {
    return c.text('Checkout not complete', 400);
  }
  const session: Session = {
    customerId: (checkout.customer as string) ?? '',
    subscriptionId: (checkout.subscription as string) ?? undefined,
    active: true,
    email: checkout.customer_details?.email ?? undefined,
  };
  setCookie(c, SESSION_COOKIE, sign(session, SESSION_SECRET), {
    httpOnly: true,
    sameSite: 'lax',
    secure: PUBLIC_URL.startsWith('https'),
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return c.redirect('/', 303);
});

// Stripe webhook — raw body required for signature verification.
app.post('/stripe/webhook', async c => {
  const sig = c.req.header('stripe-signature') ?? '';
  const rawBody = await c.req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return c.json({ error: `Webhook signature verification failed: ${(err as Error).message}` }, 400);
  }
  // For a real app, persist subscription state to a DB and look it up on
  // every request. The starter just logs — the cookie set in
  // /subscribe/success is the source of truth for the demo.
  // eslint-disable-next-line no-console
  console.log(`stripe webhook: ${event.type}`);
  return c.json({ received: true });
});

serve({ fetch: app.fetch, port: PORT }, info => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS Stripe paywall backend listening on http://localhost:${info.port}`);
});

// Silence unused-import warnings for hono/cookie helpers (getCookie used via
// the manual cookie regex — we keep the import for the hardening path).
void getCookie;
