import { createHmac, randomBytes } from 'node:crypto';

/**
 * Tiny in-memory subscription store + dispatcher. For production:
 *
 *   - Persist subscriptions (SQL, KV, file) so they survive restarts.
 *   - Move dispatch onto a queue (BullMQ, Cloudflare Queues, SQS) so
 *     downstream slowness doesn't stall the polling loop.
 *   - Implement retry with exponential backoff + dead-letter handling.
 *
 * This file is ~80 LOC; the production version is ~5x that.
 */

export interface Subscription {
  id: string;
  url: string;
  secret: string;
  events: string[]; // empty = all events
  createdAt: string;
}

export type Event =
  | { type: 'post.added', key: string, updatedAt: string | null }
  | { type: 'post.changed', key: string, updatedAt: string | null }
  | { type: 'post.removed', key: string };

export class WebhookHub {
  private subscriptions = new Map<string, Subscription>();

  subscribe(url: string, events: string[] = []): Subscription {
    const id = randomBytes(8).toString('hex');
    const secret = randomBytes(24).toString('hex');
    const sub: Subscription = { id, url, secret, events, createdAt: new Date().toISOString() };
    this.subscriptions.set(id, sub);
    return sub;
  }

  unsubscribe(id: string): boolean {
    return this.subscriptions.delete(id);
  }

  list(): Subscription[] {
    return [...this.subscriptions.values()];
  }

  async dispatch(event: Event): Promise<void> {
    const body = JSON.stringify({ ...event, timestamp: new Date().toISOString() });
    await Promise.allSettled(
      [...this.subscriptions.values()]
        .filter(sub => sub.events.length === 0 || sub.events.includes(event.type))
        .map(async sub => {
          const signature = createHmac('sha256', sub.secret).update(body).digest('hex');
          try {
            const res = await fetch(sub.url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-LaikaCMS-Signature': `sha256=${signature}`,
                'X-LaikaCMS-Event': event.type,
                'X-LaikaCMS-Delivery': randomBytes(8).toString('hex'),
              },
              body,
              signal: AbortSignal.timeout(5000),
            });
            if (!res.ok) {
              // eslint-disable-next-line no-console
              console.warn(`webhook ${sub.id} returned ${res.status} from ${sub.url}`);
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(`webhook ${sub.id} failed for ${sub.url}:`, err);
          }
        }),
    );
  }
}
