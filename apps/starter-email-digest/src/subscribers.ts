import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * Tiny JSON-file subscriber store. Production: a real DB (Postgres, SQLite,
 * Drizzle, etc.). The starter uses a file so it's runnable with no extra
 * infrastructure.
 */

export interface Subscriber {
  email: string;
  subscribedAt: string;
  lastDigestSentAt: string | null;
  /** Random unsubscribe token. Lets recipients leave without logging in. */
  unsubscribeToken: string;
}

export class SubscriberStore {
  constructor(private filePath: string) {}

  private async readAll(): Promise<Subscriber[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      return JSON.parse(raw) as Subscriber[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  private async writeAll(subs: Subscriber[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(subs, null, 2), 'utf8');
  }

  async list(): Promise<Subscriber[]> {
    return this.readAll();
  }

  async add(email: string): Promise<Subscriber> {
    const all = await this.readAll();
    const existing = all.find(s => s.email === email);
    if (existing) return existing;
    const sub: Subscriber = {
      email,
      subscribedAt: new Date().toISOString(),
      lastDigestSentAt: null,
      unsubscribeToken: cryptoRandomToken(),
    };
    all.push(sub);
    await this.writeAll(all);
    return sub;
  }

  async unsubscribeByToken(token: string): Promise<boolean> {
    const all = await this.readAll();
    const next = all.filter(s => s.unsubscribeToken !== token);
    if (next.length === all.length) return false;
    await this.writeAll(next);
    return true;
  }

  async markSent(email: string, when: string): Promise<void> {
    const all = await this.readAll();
    const sub = all.find(s => s.email === email);
    if (!sub) return;
    sub.lastDigestSentAt = when;
    await this.writeAll(all);
  }
}

function cryptoRandomToken(): string {
  // 16 bytes → 32 hex chars. node:crypto avoids a `Math.random()` dep.
  const buf = new Uint8Array(16);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

export function createSubscriberStore(): SubscriberStore {
  return new SubscriberStore(resolve(process.env.SUBSCRIBERS_FILE ?? './data/subscribers.json'));
}
