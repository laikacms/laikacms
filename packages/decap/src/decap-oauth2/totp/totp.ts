/**
 * TOTP (Time-based One-Time Password) 2FA Module
 *
 * Implements RFC 6238 TOTP for two-factor authentication.
 * Compatible with Google Authenticator, Authy, and other TOTP apps.
 * Works in both Cloudflare Workers and Node.js environments.
 *
 * @module @laikacms/decap-api/oauth2/totp
 */

import { constantTimeEqual } from 'laikacms/crypto';
import { generateQRCodeDataURI } from '../qrcode/svg.js';

// ============================================================================
// Constants
// ============================================================================

const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30; // seconds
const SECRET_LENGTH = 20; // bytes (160 bits)

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * TOTP secret data for a user
 */
export interface TOTPSecret {
  /** Base32-encoded secret */
  secret: string;
  /** User ID */
  userId: string;
  /** Whether TOTP is enabled/verified */
  enabled: boolean;
  /** Creation timestamp */
  createdAt: number;
  /** Last verification timestamp */
  lastVerifiedAt?: number;
}

/**
 * Backup code for account recovery
 */
export interface BackupCode {
  /** The backup code (hashed) */
  codeHash: string;
  /** User ID */
  userId: string;
  /** Whether the code has been used */
  used: boolean;
  /** Creation timestamp */
  createdAt: number;
  /** Used timestamp */
  usedAt?: number;
}

/**
 * Callbacks for TOTP storage operations
 */
export interface TOTPCallbacks {
  /** Store TOTP secret for a user */
  storeTOTPSecret(secret: TOTPSecret): Promise<void>;

  /** Get TOTP secret for a user */
  getTOTPSecret(userId: string): Promise<TOTPSecret | null>;

  /** Update TOTP secret */
  updateTOTPSecret(userId: string, updates: Partial<TOTPSecret>): Promise<void>;

  /** Delete TOTP secret (disable 2FA) */
  deleteTOTPSecret(userId: string): Promise<void>;
}

/**
 * OAuth-specific TOTP callbacks for simplified OAuth authentication flow.
 */
export interface OAuthTotpCallbacks {
  /** Check if user has TOTP enabled */
  hasTotp(userId: string): Promise<boolean>;
  /** Get user's TOTP secret as a string for verification */
  getTotpSecret(userId: string): Promise<string | null>;
  /** Store TOTP secret for a user */
  storeTotpSecret(userId: string, secret: string): Promise<void>;
  /** Store a pending TOTP session (after password verification, before TOTP verification) */
  storePendingTotpSession(sessionId: string, userId: string, expiresAt: number): Promise<void>;
  /** Get a pending TOTP session */
  getPendingTotpSession(sessionId: string): Promise<{ userId: string } | null>;
  /**
   * Delete a pending TOTP session. Called after the session has been consumed
   * (a TOTP code was successfully verified) so the same session token cannot be
   * replayed. Optional for backward compatibility — implementations that omit
   * this rely on natural expiry, which the security audit flags as Medium.
   */
  deletePendingTotpSession?(sessionId: string): Promise<void>;
  /**
   * Return the most recently consumed TOTP time step for the user, or null if
   * none has been recorded. Together with `setLastTotpStep` this provides
   * RFC 6238 §5.2 replay protection. Optional for backward compatibility.
   */
  getLastTotpStep?(userId: string): Promise<number | null>;
  /** Record the time step of a successfully consumed TOTP code. */
  setLastTotpStep?(userId: string, step: number): Promise<void>;
}

/**
 * TOTP configuration
 */
export interface TOTPConfig {
  /** Issuer name (displayed in authenticator app) */
  issuer: string;

  /** Callbacks for storage operations */
  callbacks: TOTPCallbacks;

  /** Number of time steps to allow for clock drift (default: 1) */
  window?: number;
}

/**
 * OAuth TOTP configuration - standalone config for OAuth authentication flow.
 * Uses a simpler callback interface than the full TOTPConfig.
 */
export interface OAuthTotpConfig {
  /** Enable TOTP 2FA */
  enabled: boolean;
  /** Require users to set up TOTP (forces enrollment if not configured) */
  required?: boolean;
  /** Issuer name (displayed in authenticator app) */
  issuer: string;
  /** Number of time steps to allow for clock drift (default: 1) */
  window?: number;
  /** Callbacks for TOTP operations */
  callbacks: OAuthTotpCallbacks;
}

// ============================================================================
// Base32 Encoding/Decoding
// ============================================================================

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encode bytes to Base32
 */
function base32Encode(data: Uint8Array): string {
  let result = '';
  let bits = 0;
  let value = 0;

  for (let i = 0; i < data.length; i++) {
    value = (value << 8) | data[i];
    bits += 8;

    while (bits >= 5) {
      result += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    result += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return result;
}

/**
 * Decode Base32 to bytes
 */
function base32Decode(str: string): Uint8Array {
  // Remove padding and convert to uppercase
  const input = str.replace(/=+$/, '').toUpperCase();

  const output: number[] = [];
  let bits = 0;
  let value = 0;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid Base32 character: ${char}`);
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(output);
}

const uint8ArrayToArrayBuffer = (u8: Uint8Array): ArrayBuffer => {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer; // SharedArrayBuffer messes up types
};

// ============================================================================
// HMAC-SHA1 Implementation
// ============================================================================

/**
 * Compute HMAC-SHA1
 */
async function hmacSha1(key: Uint8Array, message: Uint8Array): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    uint8ArrayToArrayBuffer(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );

  return crypto.subtle.sign('HMAC', cryptoKey, uint8ArrayToArrayBuffer(message));
}

// ============================================================================
// TOTP Generation and Verification
// ============================================================================

/**
 * Generate a cryptographically secure TOTP secret
 */
export function generateTOTPSecret(): string {
  const bytes = new Uint8Array(SECRET_LENGTH);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

/**
 * Generate TOTP code for a given secret and time
 */
export async function generateTOTP(
  secret: string,
  time: number = Date.now(),
): Promise<string> {
  // Decode secret
  const key = base32Decode(secret);

  // Calculate time step
  const timeStep = Math.floor(time / 1000 / TOTP_PERIOD);

  // Convert time step to 8-byte big-endian buffer
  const timeBuffer = new ArrayBuffer(8);
  const timeView = new DataView(timeBuffer);
  timeView.setUint32(4, timeStep, false); // Big-endian, lower 32 bits

  // Compute HMAC
  const hmac = await hmacSha1(key, new Uint8Array(timeBuffer));
  const hmacBytes = new Uint8Array(hmac);

  // Dynamic truncation
  const offset = hmacBytes[hmacBytes.length - 1] & 0x0f;
  const code = (
    ((hmacBytes[offset] & 0x7f) << 24)
    | ((hmacBytes[offset + 1] & 0xff) << 16)
    | ((hmacBytes[offset + 2] & 0xff) << 8)
    | (hmacBytes[offset + 3] & 0xff)
  ) % Math.pow(10, TOTP_DIGITS);

  // Pad with leading zeros
  return code.toString().padStart(TOTP_DIGITS, '0');
}

/**
 * Verify a TOTP code
 */
export async function verifyTOTP(
  secret: string,
  code: string,
  window: number = 1,
): Promise<boolean> {
  const result = await verifyTOTPWithStep(secret, code, window);
  return result.valid;
}

/**
 * Verify a TOTP code and return the matched time step. Callers that wish to
 * implement RFC 6238 §5.2 replay protection use the returned step to ensure
 * a code is only accepted once per user.
 */
export async function verifyTOTPWithStep(
  secret: string,
  code: string,
  window: number = 1,
): Promise<{ valid: boolean, step?: number }> {
  // Normalize code
  const normalizedCode = code.replace(/\s/g, '');
  if (normalizedCode.length !== TOTP_DIGITS) {
    return { valid: false };
  }

  const now = Date.now();
  const currentStep = Math.floor(now / 1000 / TOTP_PERIOD);

  // Check current time step and window — iterate the full window even when an
  // early match is found so total work is constant for the same input length.
  let matchedStep: number | undefined;
  for (let i = -window; i <= window; i++) {
    const candidateStep = currentStep + i;
    const time = candidateStep * TOTP_PERIOD * 1000;
    const expectedCode = await generateTOTP(secret, time);

    if (await constantTimeEqual(normalizedCode, expectedCode)) {
      matchedStep = candidateStep;
    }
  }

  return matchedStep === undefined
    ? { valid: false }
    : { valid: true, step: matchedStep };
}

/**
 * Verify a TOTP code against the OAuth callbacks with RFC 6238 §5.2 replay
 * protection. If `getLastTotpStep`/`setLastTotpStep` are provided, codes whose
 * time step is less than or equal to the previously consumed step are rejected.
 */
export async function verifyOAuthTOTPWithReplayProtection(
  userId: string,
  code: string,
  callbacks: OAuthTotpCallbacks,
  options: { window?: number } = {},
): Promise<{ valid: boolean, replay?: boolean }> {
  const secret = await callbacks.getTotpSecret(userId);
  if (!secret) {
    return { valid: false };
  }

  const result = await verifyTOTPWithStep(secret, code, options.window ?? 1);
  if (!result.valid || result.step === undefined) {
    return { valid: false };
  }

  if (callbacks.getLastTotpStep) {
    const last = await callbacks.getLastTotpStep(userId);
    if (last !== null && result.step <= last) {
      return { valid: false, replay: true };
    }
  }

  if (callbacks.setLastTotpStep) {
    await callbacks.setLastTotpStep(userId, result.step);
  }

  return { valid: true };
}

// ============================================================================
// TOTP Setup and Management
// ============================================================================

/**
 * Generate TOTP setup data for a user
 */
export interface TOTPSetupData {
  /** Base32-encoded secret */
  secret: string;
  /** otpauth:// URI for QR code */
  uri: string;
  /** QR code data URL (SVG) */
  qrCode: string;
}

/**
 * Start TOTP setup for a user
 */
export async function setupTOTP(
  userId: string,
  userEmail: string,
  config: TOTPConfig,
): Promise<TOTPSetupData> {
  const { issuer, callbacks } = config;

  // Generate new secret
  const secret = generateTOTPSecret();

  // Store secret (not enabled yet)
  await callbacks.storeTOTPSecret({
    secret,
    userId,
    enabled: false,
    createdAt: Date.now(),
  });

  // Generate otpauth URI
  const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(userEmail)}?secret=${secret}&issuer=${
    encodeURIComponent(issuer)
  }&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;

  // Generate QR code as data URI for embedding in img tags
  const qrCode = generateQRCodeDataURI(uri);

  return { secret, uri, qrCode };
}

/**
 * Verify TOTP setup and enable 2FA
 */
export async function verifyTOTPSetup(
  userId: string,
  code: string,
  config: TOTPConfig,
): Promise<{ success: boolean, error?: string }> {
  const { callbacks, window = 1 } = config;

  // Get stored secret
  const totpSecret = await callbacks.getTOTPSecret(userId);
  if (!totpSecret) {
    return { success: false, error: 'TOTP not set up' };
  }

  if (totpSecret.enabled) {
    return { success: false, error: 'TOTP already enabled' };
  }

  // Verify code
  const isValid = await verifyTOTP(totpSecret.secret, code, window);
  if (!isValid) {
    return { success: false, error: 'Invalid code' };
  }

  // Enable TOTP
  await callbacks.updateTOTPSecret(userId, {
    enabled: true,
    lastVerifiedAt: Date.now(),
  });

  return { success: true };
}

/**
 * Verify TOTP code during login
 */
export async function verifyTOTPLogin(
  userId: string,
  code: string,
  config: TOTPConfig,
): Promise<{ success: boolean, error?: string }> {
  const { callbacks, window = 1 } = config;

  // Get stored secret
  const totpSecret = await callbacks.getTOTPSecret(userId);
  if (!totpSecret || !totpSecret.enabled) {
    return { success: false, error: 'TOTP not enabled' };
  }

  // Verify code
  const isValid = await verifyTOTP(totpSecret.secret, code, window);
  if (!isValid) {
    return { success: false, error: 'Invalid code' };
  }

  // Update last verified
  await callbacks.updateTOTPSecret(userId, {
    lastVerifiedAt: Date.now(),
  });

  return { success: true };
}

/**
 * Disable TOTP for a user
 */
export async function disableTOTP(
  userId: string,
  config: TOTPConfig,
): Promise<void> {
  await config.callbacks.deleteTOTPSecret(userId);
}

/**
 * Check if user has TOTP enabled
 */
export async function hasTOTPEnabled(
  userId: string,
  config: TOTPConfig,
): Promise<boolean> {
  const totpSecret = await config.callbacks.getTOTPSecret(userId);
  return totpSecret?.enabled ?? false;
}

/**
 * Start TOTP setup for OAuth flow
 */
export async function setupOAuthTOTP(
  userId: string,
  userEmail: string,
  config: OAuthTotpConfig,
): Promise<TOTPSetupData> {
  const { issuer, callbacks } = config;

  // Generate new secret
  const secret = generateTOTPSecret();

  // Store secret (will be enabled after verification)
  await callbacks.storeTotpSecret(userId, secret);

  // Generate otpauth URI
  const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(userEmail)}?secret=${secret}&issuer=${
    encodeURIComponent(issuer)
  }&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;

  // Generate QR code as data URI for embedding in img tags
  const qrCode = generateQRCodeDataURI(uri);

  return { secret, uri, qrCode };
}

/**
 * Verify TOTP setup and enable 2FA for OAuth flow
 */
export async function verifyOAuthTOTPSetup(
  userId: string,
  code: string,
  config: OAuthTotpConfig,
): Promise<{ success: boolean, error?: string }> {
  const { callbacks, window = 1 } = config;

  // Get stored secret
  const secret = await callbacks.getTotpSecret(userId);
  if (!secret) {
    return { success: false, error: 'TOTP not set up' };
  }

  // Verify code
  const isValid = await verifyTOTP(secret, code, window);
  if (!isValid) {
    return { success: false, error: 'Invalid code' };
  }

  return { success: true };
}

/**
 * Verify TOTP code during OAuth login
 */
export async function verifyOAuthTOTPLogin(
  userId: string,
  code: string,
  config: OAuthTotpConfig,
): Promise<{ success: boolean, error?: string }> {
  const { callbacks, window = 1 } = config;

  // Get stored secret
  const secret = await callbacks.getTotpSecret(userId);
  if (!secret) {
    return { success: false, error: 'TOTP not enabled' };
  }

  // Verify code
  const isValid = await verifyTOTP(secret, code, window);
  if (!isValid) {
    return { success: false, error: 'Invalid code' };
  }

  return { success: true };
}
