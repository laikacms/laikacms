/**
 * Unit tests for packages/decap/src/decap-oauth2/email/email.ts
 *
 * Covers:
 *  - requestPasswordReset: token stored via storeResetToken, email sent via provider.sendEmail,
 *    email send failure cleans up token
 *  - resetPassword: valid token → password updated; expired token → error;
 *    invalid/short token → error; missing token → error
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../oauth2.js';
import { requestPasswordReset, resetPassword } from './email.js';
import type {
  EmailMessage,
  EmailProvider,
  EmailSendResult,
  PasswordResetCallbacks,
  PasswordResetConfig,
  PasswordResetToken,
} from './email.js';

// ---------------------------------------------------------------------------
// Mock laikacms/crypto so tests don't run bcrypt (slow) or timing delays
// ---------------------------------------------------------------------------

vi.mock('laikacms/crypto', () => ({
  addTimingJitter: vi.fn().mockResolvedValue(undefined),
  generateSecureRandomString: vi.fn().mockImplementation((len: number) => 'x'.repeat(len)),
  hashPassword: vi.fn().mockImplementation(async (pw: string) => `hashed:${pw}`),
}));

import { addTimingJitter, hashPassword } from 'laikacms/crypto';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'user@example.com',
    passwordHash: '$2a$10$placeholder',
    ...overrides,
  };
}

function makeEmailProvider(overrides: Partial<EmailProvider> = {}): EmailProvider & { sentMessages: EmailMessage[] } {
  const sentMessages: EmailMessage[] = [];
  return {
    sentMessages,
    send: vi.fn().mockImplementation(async (msg: EmailMessage): Promise<EmailSendResult> => {
      sentMessages.push(msg);
      return { success: true, messageId: 'msg-1' };
    }),
    ...overrides,
  };
}

function makeCallbacks(
  tokenStore: Map<string, PasswordResetToken> = new Map(),
  overrides: Partial<PasswordResetCallbacks> = {},
): PasswordResetCallbacks {
  return {
    storeResetToken: vi.fn().mockImplementation(async (token: PasswordResetToken) => {
      tokenStore.set(token.token, token);
    }),
    getResetToken: vi.fn().mockImplementation(async (token: string) => {
      return tokenStore.get(token) ?? null;
    }),
    deleteResetToken: vi.fn().mockImplementation(async (token: string) => {
      tokenStore.delete(token);
    }),
    updateUserPassword: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeConfig(
  callbacks: PasswordResetCallbacks,
  provider: EmailProvider,
  overrides: Partial<PasswordResetConfig> = {},
): PasswordResetConfig {
  return {
    emailProvider: provider,
    callbacks,
    resetBaseUrl: 'https://example.com/reset-password',
    fromEmail: 'noreply@example.com',
    appName: 'Test CMS',
    supportEmail: 'support@example.com',
    tokenExpiration: 3600,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// requestPasswordReset
// ---------------------------------------------------------------------------

describe('requestPasswordReset', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('stores the reset token via storeResetToken', async () => {
    const tokenStore = new Map<string, PasswordResetToken>();
    const callbacks = makeCallbacks(tokenStore);
    const provider = makeEmailProvider();
    const config = makeConfig(callbacks, provider);
    const user = makeUser();

    const result = await requestPasswordReset(user, config);

    expect(result.success).toBe(true);
    expect(callbacks.storeResetToken).toHaveBeenCalledOnce();
    const storedArg = vi.mocked(callbacks.storeResetToken).mock.calls[0][0];
    expect(storedArg.userId).toBe(user.id);
    expect(storedArg.email).toBe(user.email);
    expect(storedArg.token).toBeTruthy();
    expect(typeof storedArg.expiresAt).toBe('number');
    expect(storedArg.expiresAt).toBeGreaterThan(Date.now());
  });

  it('sends email to the user via provider.send', async () => {
    const tokenStore = new Map<string, PasswordResetToken>();
    const callbacks = makeCallbacks(tokenStore);
    const provider = makeEmailProvider();
    const config = makeConfig(callbacks, provider);
    const user = makeUser();

    const result = await requestPasswordReset(user, config);

    expect(result.success).toBe(true);
    expect(provider.send).toHaveBeenCalledOnce();
    const sentMsg = provider.sentMessages[0];
    expect(sentMsg.to).toBe(user.email);
    expect(sentMsg.from).toBe('noreply@example.com');
    expect(sentMsg.subject).toContain('Test CMS');
    expect(sentMsg.html).toBeTruthy();
  });

  it('includes the reset token in the email link', async () => {
    const tokenStore = new Map<string, PasswordResetToken>();
    const callbacks = makeCallbacks(tokenStore);
    const provider = makeEmailProvider();
    const config = makeConfig(callbacks, provider);
    const user = makeUser();

    await requestPasswordReset(user, config);

    const sentMsg = provider.sentMessages[0];
    // The mocked generateSecureRandomString returns 'x'.repeat(len)
    expect(sentMsg.html).toContain('token=');
    expect(sentMsg.html).toContain('reset-password');
  });

  it('deletes token and returns error when email send fails', async () => {
    const tokenStore = new Map<string, PasswordResetToken>();
    const callbacks = makeCallbacks(tokenStore);
    const failingProvider: EmailProvider = {
      send: vi.fn().mockResolvedValue({ success: false, error: 'SMTP error' }),
    };
    const config = makeConfig(callbacks, failingProvider);
    const user = makeUser();

    const result = await requestPasswordReset(user, config);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    // Token should be cleaned up after send failure
    expect(callbacks.deleteResetToken).toHaveBeenCalledOnce();
    // Token store should be empty
    expect(tokenStore.size).toBe(0);
  });

  it('uses default error message when provider returns no error string', async () => {
    const tokenStore = new Map<string, PasswordResetToken>();
    const callbacks = makeCallbacks(tokenStore);
    const failingProvider: EmailProvider = {
      send: vi.fn().mockResolvedValue({ success: false }),
    };
    const config = makeConfig(callbacks, failingProvider);
    const user = makeUser();

    const result = await requestPasswordReset(user, config);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to send email');
  });

  it('uses custom tokenExpiration when provided', async () => {
    const tokenStore = new Map<string, PasswordResetToken>();
    const callbacks = makeCallbacks(tokenStore);
    const provider = makeEmailProvider();
    const config = makeConfig(callbacks, provider, { tokenExpiration: 1800 });
    const user = makeUser();

    const before = Date.now();
    await requestPasswordReset(user, config);
    const after = Date.now();

    const storedArg = vi.mocked(callbacks.storeResetToken).mock.calls[0][0];
    expect(storedArg.expiresAt).toBeGreaterThanOrEqual(before + 1800 * 1000);
    expect(storedArg.expiresAt).toBeLessThanOrEqual(after + 1800 * 1000);
  });

  it('uses custom renderHtml when provided', async () => {
    const tokenStore = new Map<string, PasswordResetToken>();
    const callbacks = makeCallbacks(tokenStore);
    const provider = makeEmailProvider();
    const customHtml = vi.fn().mockReturnValue('<custom>html</custom>');
    const config = makeConfig(callbacks, provider, { renderHtml: customHtml });
    const user = makeUser();

    await requestPasswordReset(user, config);

    expect(customHtml).toHaveBeenCalledOnce();
    expect(provider.sentMessages[0].html).toBe('<custom>html</custom>');
  });
});

// ---------------------------------------------------------------------------
// resetPassword
// ---------------------------------------------------------------------------

describe('resetPassword', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  function makeValidToken(overrides: Partial<PasswordResetToken> = {}): PasswordResetToken {
    return {
      token: 'x'.repeat(64),
      userId: 'user-1',
      email: 'user@example.com',
      expiresAt: Date.now() + 3600 * 1000,
      createdAt: Date.now(),
      ...overrides,
    };
  }

  it('updates the user password for a valid token', async () => {
    const validToken = makeValidToken();
    const tokenStore = new Map<string, PasswordResetToken>([[validToken.token, validToken]]);
    const callbacks = makeCallbacks(tokenStore);
    const provider = makeEmailProvider();
    const config = makeConfig(callbacks, provider);

    const result = await resetPassword(validToken.token, 'newPassword123', config);

    expect(result.success).toBe(true);
    expect(result.userId).toBe('user-1');
    expect(callbacks.updateUserPassword).toHaveBeenCalledOnce();
    const [userId, passwordHash] = vi.mocked(callbacks.updateUserPassword).mock.calls[0];
    expect(userId).toBe('user-1');
    expect(passwordHash).toBe('hashed:newPassword123');
  });

  it('deletes the token after a successful password reset', async () => {
    const validToken = makeValidToken();
    const tokenStore = new Map<string, PasswordResetToken>([[validToken.token, validToken]]);
    const callbacks = makeCallbacks(tokenStore);
    const provider = makeEmailProvider();
    const config = makeConfig(callbacks, provider);

    await resetPassword(validToken.token, 'newPassword123', config);

    expect(callbacks.deleteResetToken).toHaveBeenCalledWith(validToken.token);
    expect(tokenStore.size).toBe(0);
  });

  it('returns error for an expired token and deletes it', async () => {
    const expiredToken = makeValidToken({ expiresAt: Date.now() - 1000 });
    const tokenStore = new Map<string, PasswordResetToken>([[expiredToken.token, expiredToken]]);
    const callbacks = makeCallbacks(tokenStore);
    const provider = makeEmailProvider();
    const config = makeConfig(callbacks, provider);

    const result = await resetPassword(expiredToken.token, 'newPassword123', config);

    expect(result.success).toBe(false);
    expect(result.error).toContain('expired');
    expect(callbacks.deleteResetToken).toHaveBeenCalledWith(expiredToken.token);
    expect(callbacks.updateUserPassword).not.toHaveBeenCalled();
  });

  it('returns error for a token not found in store', async () => {
    const tokenStore = new Map<string, PasswordResetToken>();
    const callbacks = makeCallbacks(tokenStore);
    const provider = makeEmailProvider();
    const config = makeConfig(callbacks, provider);

    const unknownToken = 'y'.repeat(64);
    const result = await resetPassword(unknownToken, 'newPassword123', config);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid or expired');
    expect(addTimingJitter).toHaveBeenCalled();
    expect(callbacks.updateUserPassword).not.toHaveBeenCalled();
  });

  it('adds timing jitter when token is not found (anti-timing-attack)', async () => {
    const tokenStore = new Map<string, PasswordResetToken>();
    const callbacks = makeCallbacks(tokenStore);
    const provider = makeEmailProvider();
    const config = makeConfig(callbacks, provider);

    await resetPassword('y'.repeat(64), 'newPassword123', config);

    expect(addTimingJitter).toHaveBeenCalledWith(200);
  });

  it('returns error when token string is too short (< 32 chars)', async () => {
    const tokenStore = new Map<string, PasswordResetToken>();
    const callbacks = makeCallbacks(tokenStore);
    const provider = makeEmailProvider();
    const config = makeConfig(callbacks, provider);

    const result = await resetPassword('short', 'newPassword123', config);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid reset token');
    expect(callbacks.getResetToken).not.toHaveBeenCalled();
  });

  it('returns error when token is empty', async () => {
    const tokenStore = new Map<string, PasswordResetToken>();
    const callbacks = makeCallbacks(tokenStore);
    const provider = makeEmailProvider();
    const config = makeConfig(callbacks, provider);

    const result = await resetPassword('', 'newPassword123', config);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid reset token');
  });

  it('returns error when new password is too short (< 8 chars)', async () => {
    const validToken = makeValidToken();
    const tokenStore = new Map<string, PasswordResetToken>([[validToken.token, validToken]]);
    const callbacks = makeCallbacks(tokenStore);
    const provider = makeEmailProvider();
    const config = makeConfig(callbacks, provider);

    const result = await resetPassword(validToken.token, 'short', config);

    expect(result.success).toBe(false);
    expect(result.error).toContain('8 characters');
    expect(callbacks.updateUserPassword).not.toHaveBeenCalled();
  });

  it('returns error when new password is empty', async () => {
    const validToken = makeValidToken();
    const tokenStore = new Map<string, PasswordResetToken>([[validToken.token, validToken]]);
    const callbacks = makeCallbacks(tokenStore);
    const provider = makeEmailProvider();
    const config = makeConfig(callbacks, provider);

    const result = await resetPassword(validToken.token, '', config);

    expect(result.success).toBe(false);
    expect(result.error).toContain('8 characters');
  });

  it('hashes the new password via hashPassword before storing', async () => {
    const validToken = makeValidToken();
    const tokenStore = new Map<string, PasswordResetToken>([[validToken.token, validToken]]);
    const callbacks = makeCallbacks(tokenStore);
    const provider = makeEmailProvider();
    const config = makeConfig(callbacks, provider);

    await resetPassword(validToken.token, 'securePass1', config);

    expect(hashPassword).toHaveBeenCalledWith('securePass1');
    const storedHash = vi.mocked(callbacks.updateUserPassword).mock.calls[0][1];
    expect(storedHash).toBe('hashed:securePass1');
  });
});
