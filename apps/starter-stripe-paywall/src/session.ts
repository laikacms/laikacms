import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Tiny signed-cookie session. The cookie value is `<json>.<hmac>` where
 * `<json>` is base64-encoded JSON and `<hmac>` is a base64url HMAC-SHA256
 * over `<json>` with `SESSION_SECRET`. No third-party deps.
 *
 * Production: use `iron-session` or `cookie-session` for things like
 * rolling cookies, encryption at rest, multi-secret rotation, etc.
 */
export interface Session {
  customerId: string;
  subscriptionId?: string;
  active: boolean;
  email?: string;
}

function b64(buf: Buffer): string {
  return buf.toString('base64url');
}

function unb64(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

export function sign(session: Session, secret: string): string {
  const payload = b64(Buffer.from(JSON.stringify(session)));
  const hmac = createHmac('sha256', secret).update(payload).digest();
  return `${payload}.${b64(hmac)}`;
}

export function verify(token: string | undefined | null, secret: string): Session | null {
  if (!token) return null;
  const [payload, hmac] = token.split('.');
  if (!payload || !hmac) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const received = unb64(hmac);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    return JSON.parse(unb64(payload).toString('utf8')) as Session;
  } catch {
    return null;
  }
}
