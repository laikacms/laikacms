/**
 * Unit tests for packages/decap/src/decap-oauth2/passkey/passkey.ts
 *
 * Covers:
 *  - generateRegistrationOptions: output shape, challenge generation, rpId, excludeCredentials
 *  - verifyRegistration: valid credential path, bad clientDataJSON, origin mismatch, rpId mismatch
 *  - generateAuthenticationOptions: challenge stored via callbacks, allowCredentials populated
 *  - verifyAuthentication: valid assertion + counter increment, counter replay rejection, unknown credential
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PasskeyCallbacks, PasskeyConfig, StoredChallenge, StoredCredential } from './passkey.js';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from './passkey.js';

// ---------------------------------------------------------------------------
// Mock laikacms/crypto — constantTimeEqualBuffer is the only import
// ---------------------------------------------------------------------------

vi.mock('laikacms/crypto', () => ({
  constantTimeEqualBuffer: vi.fn().mockImplementation(async (a: Uint8Array, b: Uint8Array) => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }),
}));

// ---------------------------------------------------------------------------
// Binary encoding helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlDecode(str: string): Uint8Array {
  let padded = str.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) padded += '=';
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Minimal CBOR encoder sufficient for the attestation object shape passkey.ts expects */
function encodeCBOR(value: unknown): Uint8Array {
  const parts: Uint8Array[] = [];

  function encode(v: unknown): void {
    if (v instanceof Uint8Array) {
      // Major type 2 (byte string)
      encodeLength(2, v.length);
      parts.push(v);
    } else if (typeof v === 'string') {
      const bytes = new TextEncoder().encode(v);
      // Major type 3 (text string)
      encodeLength(3, bytes.length);
      parts.push(bytes);
    } else if (typeof v === 'number' && Number.isInteger(v)) {
      if (v >= 0) {
        encodeLength(0, v);
      } else {
        encodeLength(1, -1 - v);
      }
    } else if (typeof v === 'boolean') {
      parts.push(new Uint8Array([v ? 0xf5 : 0xf4]));
    } else if (v === null) {
      parts.push(new Uint8Array([0xf6]));
    } else if (Array.isArray(v)) {
      encodeLength(4, v.length);
      for (const item of v) encode(item);
    } else if (typeof v === 'object' && v !== null) {
      const entries = Object.entries(v as Record<string, unknown>);
      encodeLength(5, entries.length);
      for (const [k, val] of entries) {
        encode(k);
        encode(val);
      }
    } else {
      throw new Error(`Unsupported CBOR value type: ${typeof v}`);
    }
  }

  function encodeLength(majorType: number, length: number): void {
    const mt = majorType << 5;
    if (length < 24) {
      parts.push(new Uint8Array([mt | length]));
    } else if (length < 256) {
      parts.push(new Uint8Array([mt | 24, length]));
    } else if (length < 65536) {
      parts.push(new Uint8Array([mt | 25, length >> 8, length & 0xff]));
    } else {
      parts.push(
        new Uint8Array([mt | 26, (length >> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]),
      );
    }
  }

  encode(value);

  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
}

/** Build authenticator data for registration (with attested credential data) */
async function buildAuthenticatorDataForRegistration(
  rpId: string,
  credentialId: Uint8Array,
  publicKeyCose: Uint8Array,
  signCount = 0,
  flags = 0x45, // UP | UV | AT
): Promise<Uint8Array> {
  const rpIdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId)));

  // flags byte: UP=0x01, UV=0x04, AT=0x40
  // aaguid: 16 zero bytes
  const aaguid = new Uint8Array(16);
  const credIdLen = new Uint8Array(2);
  new DataView(credIdLen.buffer).setUint16(0, credentialId.length, false);

  // sign count: 4 bytes big-endian
  const signCountBytes = new Uint8Array(4);
  new DataView(signCountBytes.buffer).setUint32(0, signCount, false);

  const authData = new Uint8Array(
    32 + 1 + 4 + 16 + 2 + credentialId.length + publicKeyCose.length,
  );
  let offset = 0;
  authData.set(rpIdHash, offset);
  offset += 32;
  authData[offset++] = flags;
  authData.set(signCountBytes, offset);
  offset += 4;
  authData.set(aaguid, offset);
  offset += 16;
  authData.set(credIdLen, offset);
  offset += 2;
  authData.set(credentialId, offset);
  offset += credentialId.length;
  authData.set(publicKeyCose, offset);
  return authData;
}

/** Build authenticator data for authentication (no attested credential data) */
async function buildAuthenticatorDataForAuthentication(
  rpId: string,
  signCount = 1,
  flags = 0x05, // UP | UV
): Promise<Uint8Array> {
  const rpIdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId)));
  const signCountBytes = new Uint8Array(4);
  new DataView(signCountBytes.buffer).setUint32(0, signCount, false);
  const authData = new Uint8Array(37);
  authData.set(rpIdHash, 0);
  authData[32] = flags;
  authData.set(signCountBytes, 33);
  return authData;
}

/** Generate a real P-256 key pair and return publicKey in COSE format */
async function generateTestKeyPair(): Promise<{
  privateKey: CryptoKey,
  publicKeyCose: Uint8Array,
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );

  // Export public key as JWK to get x/y coordinates
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const x = base64UrlDecode(jwk.x!);
  const y = base64UrlDecode(jwk.y!);

  // Encode as COSE_Key: {1: 2, 3: -7, -1: 1, -2: x, -3: y}
  // Using integer keys (CBOR) - we encode manually
  // COSE keys are integers; we encode them as numeric keys in the object
  // The decoder in passkey.ts uses String(key) so we pass string representations of numbers
  const coseParts: Uint8Array[] = [];

  // Map with 5 entries
  coseParts.push(new Uint8Array([0xa5])); // map(5)

  function cborInt(n: number): Uint8Array {
    if (n >= 0 && n < 24) return new Uint8Array([n]);
    if (n >= 0 && n < 256) return new Uint8Array([0x18, n]);
    if (n < 0) {
      const v = -1 - n;
      if (v < 24) return new Uint8Array([0x20 | v]);
      if (v < 256) return new Uint8Array([0x38, v]);
    }
    throw new Error('int out of range');
  }

  function cborBytes(b: Uint8Array): Uint8Array {
    const len = b.length < 24 ? new Uint8Array([0x40 | b.length]) : new Uint8Array([0x58, b.length]);
    const result = new Uint8Array(len.length + b.length);
    result.set(len);
    result.set(b, len.length);
    return result;
  }

  // 1: 2 (kty = EC2)
  coseParts.push(cborInt(1));
  coseParts.push(cborInt(2));
  // 3: -7 (alg = ES256)
  coseParts.push(cborInt(3));
  coseParts.push(cborInt(-7));
  // -1: 1 (crv = P-256)
  coseParts.push(cborInt(-1));
  coseParts.push(cborInt(1));
  // -2: x
  coseParts.push(cborInt(-2));
  coseParts.push(cborBytes(x));
  // -3: y
  coseParts.push(cborInt(-3));
  coseParts.push(cborBytes(y));

  const totalLen = coseParts.reduce((s, p) => s + p.length, 0);
  const publicKeyCose = new Uint8Array(totalLen);
  let off = 0;
  for (const p of coseParts) {
    publicKeyCose.set(p, off);
    off += p.length;
  }

  return { privateKey: keyPair.privateKey, publicKeyCose };
}

/** Sign data with an ECDSA private key, returning raw (r||s) signature */
async function signEcdsa(privateKey: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, data);
  return new Uint8Array(sig);
}

// ---------------------------------------------------------------------------
// In-memory callback store
// ---------------------------------------------------------------------------

function makeCallbacks(): PasskeyCallbacks & {
  _credentials: Map<string, StoredCredential>,
  _challenges: Map<string, StoredChallenge>,
} {
  const credentials = new Map<string, StoredCredential>();
  const challenges = new Map<string, StoredChallenge>();

  const users: Record<string, { id: string, email: string, name?: string }> = {
    'user-1': { id: 'user-1', email: 'alice@example.com', name: 'Alice' },
  };

  return {
    _credentials: credentials,
    _challenges: challenges,

    async storeCredential(c) {
      credentials.set(c.credentialId, c);
    },
    async getCredentialById(id) {
      return credentials.get(id) ?? null;
    },
    async getCredentialsByUserId(userId) {
      return [...credentials.values()].filter(c => c.userId === userId);
    },
    async updateCredential(id, updates) {
      const existing = credentials.get(id);
      if (existing) credentials.set(id, { ...existing, ...updates });
    },
    async deleteCredential(id) {
      credentials.delete(id);
    },
    async storeChallenge(c) {
      challenges.set(c.challenge, c);
    },
    async consumeChallenge(challenge) {
      const stored = challenges.get(challenge) ?? null;
      challenges.delete(challenge);
      return stored;
    },
    async getUserById(id) {
      return users[id] ?? null;
    },
    async getUserByEmail(email) {
      return Object.values(users).find(u => u.email === email) ?? null;
    },
    async storePendingPasskeySetupSession() {},
    async getPendingPasskeySetupSession() {
      return null;
    },
  };
}

function makeConfig(callbacks: PasskeyCallbacks, overrides: Partial<PasskeyConfig> = {}): PasskeyConfig {
  return {
    rpId: 'example.com',
    rpName: 'Example',
    origin: 'https://example.com',
    callbacks,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// generateRegistrationOptions
// ---------------------------------------------------------------------------

describe('generateRegistrationOptions', () => {
  it('returns the correct publicKey shape', async () => {
    const cb = makeCallbacks();
    const config = makeConfig(cb);

    const result = await generateRegistrationOptions('user-1', config);

    expect(result).toHaveProperty('publicKey');
    const { publicKey } = result;
    expect(publicKey.rp.id).toBe('example.com');
    expect(publicKey.rp.name).toBe('Example');
    expect(typeof publicKey.challenge).toBe('string');
    expect(publicKey.challenge.length).toBeGreaterThan(0);
    expect(publicKey.pubKeyCredParams).toEqual(
      expect.arrayContaining([
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ]),
    );
    expect(publicKey.timeout).toBeGreaterThan(0);
    expect(publicKey.attestation).toBe('none');
    expect(publicKey.authenticatorSelection.userVerification).toBe('required');
    expect(publicKey.authenticatorSelection.residentKey).toBe('preferred');
  });

  it('challenge is a valid base64url string and is stored in callbacks', async () => {
    const cb = makeCallbacks();
    const config = makeConfig(cb);

    const result = await generateRegistrationOptions('user-1', config);
    const challenge = result.publicKey.challenge;

    // base64url must not contain +/= characters
    expect(challenge).not.toMatch(/[+/=]/);

    // challenge must have been stored
    expect(cb._challenges.has(challenge)).toBe(true);
    const stored = cb._challenges.get(challenge)!;
    expect(stored.type).toBe('registration');
    expect(stored.userId).toBe('user-1');
    expect(stored.expiresAt).toBeGreaterThan(Date.now());
  });

  it('user fields are populated from the getUserById callback', async () => {
    const cb = makeCallbacks();
    const config = makeConfig(cb);

    const result = await generateRegistrationOptions('user-1', config);
    const { user } = result.publicKey;

    expect(user.name).toBe('alice@example.com');
    expect(user.displayName).toBe('Alice');
    // user.id is the base64url-encoded userId
    expect(typeof user.id).toBe('string');
  });

  it('throws when the user is not found', async () => {
    const cb = makeCallbacks();
    const config = makeConfig(cb);

    await expect(generateRegistrationOptions('nonexistent', config)).rejects.toThrow('User not found');
  });

  it('excludeCredentials is populated from existing credentials', async () => {
    const cb = makeCallbacks();
    const config = makeConfig(cb);

    // Pre-seed a credential for user-1
    await cb.storeCredential({
      credentialId: 'existing-cred-id',
      publicKey: 'pubkey',
      signCount: 0,
      userId: 'user-1',
      createdAt: Date.now(),
    });

    const result = await generateRegistrationOptions('user-1', config);
    const { excludeCredentials } = result.publicKey;

    expect(excludeCredentials).toHaveLength(1);
    expect(excludeCredentials[0].id).toBe('existing-cred-id');
    expect(excludeCredentials[0].type).toBe('public-key');
  });

  it('excludeCredentials is empty when the user has no credentials', async () => {
    const cb = makeCallbacks();
    const config = makeConfig(cb);

    const result = await generateRegistrationOptions('user-1', config);
    expect(result.publicKey.excludeCredentials).toHaveLength(0);
  });

  it('respects authenticatorAttachment config option', async () => {
    const cb = makeCallbacks();
    const config = makeConfig(cb, { authenticatorAttachment: 'platform' });

    const result = await generateRegistrationOptions('user-1', config);
    expect(result.publicKey.authenticatorSelection.authenticatorAttachment).toBe('platform');
  });
});

// ---------------------------------------------------------------------------
// verifyRegistration
// ---------------------------------------------------------------------------

describe('verifyRegistration', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let config: PasskeyConfig;

  beforeEach(() => {
    cb = makeCallbacks();
    config = makeConfig(cb);
  });

  async function buildValidRegistrationData(): Promise<{
    credentialId: Uint8Array,
    privateKey: CryptoKey,
    publicKeyCose: Uint8Array,
    challenge: string,
    clientDataJSONb64: string,
    attestationObjectB64: string,
  }> {
    // Generate key pair
    const { privateKey, publicKeyCose } = await generateTestKeyPair();

    // Generate a challenge and store it
    const challengeBytes = new Uint8Array(32);
    crypto.getRandomValues(challengeBytes);
    const challenge = base64UrlEncode(challengeBytes);
    await cb.storeChallenge({
      challenge,
      userId: 'user-1',
      expiresAt: Date.now() + 300_000,
      type: 'registration',
    });

    // Generate credential ID
    const credIdBytes = new Uint8Array(16);
    crypto.getRandomValues(credIdBytes);

    // Build authenticator data
    const authData = await buildAuthenticatorDataForRegistration('example.com', credIdBytes, publicKeyCose);

    // Build clientDataJSON
    const clientDataJSON = JSON.stringify({
      type: 'webauthn.create',
      challenge,
      origin: 'https://example.com',
      crossOrigin: false,
    });
    const clientDataJSONBytes = new TextEncoder().encode(clientDataJSON);
    const clientDataJSONb64 = base64UrlEncode(clientDataJSONBytes);

    // Build attestation object (CBOR map: {fmt: "none", attStmt: {}, authData: <bytes>})
    const attestationObject = encodeCBOR({
      fmt: 'none',
      attStmt: {},
      authData,
    });
    const attestationObjectB64 = base64UrlEncode(attestationObject);

    return {
      credentialId: credIdBytes,
      privateKey,
      publicKeyCose,
      challenge,
      clientDataJSONb64,
      attestationObjectB64,
    };
  }

  it('returns success: true and stores credential for a valid registration', async () => {
    const { credentialId, clientDataJSONb64, attestationObjectB64 } = await buildValidRegistrationData();

    const response = {
      id: base64UrlEncode(credentialId),
      rawId: base64UrlEncode(credentialId),
      type: 'public-key' as const,
      response: {
        clientDataJSON: clientDataJSONb64,
        attestationObject: attestationObjectB64,
      },
    };

    const result = await verifyRegistration(response, config, 'My Key');

    expect(result.success).toBe(true);
    expect(result.credentialId).toBeTruthy();
    expect(result.error).toBeUndefined();

    // Credential should be persisted
    const stored = await cb.getCredentialById(result.credentialId!);
    expect(stored).not.toBeNull();
    expect(stored!.userId).toBe('user-1');
    expect(stored!.name).toBe('My Key');
  });

  it('returns success: false with error when clientDataJSON type is wrong', async () => {
    const { credentialId, clientDataJSONb64: _, challenge, attestationObjectB64 } = await buildValidRegistrationData();

    // Re-put the challenge (it was consumed by buildValidRegistrationData? no — it wasn't consumed yet)
    // Overwrite clientDataJSON with wrong type
    const badClientData = JSON.stringify({
      type: 'webauthn.get', // wrong type
      challenge,
      origin: 'https://example.com',
    });
    const badB64 = base64UrlEncode(new TextEncoder().encode(badClientData));

    const response = {
      id: base64UrlEncode(credentialId),
      rawId: base64UrlEncode(credentialId),
      type: 'public-key' as const,
      response: {
        clientDataJSON: badB64,
        attestationObject: attestationObjectB64,
      },
    };

    const result = await verifyRegistration(response, config);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid client data type');
  });

  it('returns success: false when origin does not match', async () => {
    const { credentialId, challenge, attestationObjectB64 } = await buildValidRegistrationData();

    const badClientData = JSON.stringify({
      type: 'webauthn.create',
      challenge,
      origin: 'https://evil.com', // wrong origin
    });
    const badB64 = base64UrlEncode(new TextEncoder().encode(badClientData));

    const response = {
      id: base64UrlEncode(credentialId),
      rawId: base64UrlEncode(credentialId),
      type: 'public-key' as const,
      response: {
        clientDataJSON: badB64,
        attestationObject: attestationObjectB64,
      },
    };

    const result = await verifyRegistration(response, config);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Origin mismatch');
  });

  it('returns success: false when challenge is invalid/expired', async () => {
    const { credentialId, attestationObjectB64 } = await buildValidRegistrationData();

    // Use a challenge that was never stored
    const badClientData = JSON.stringify({
      type: 'webauthn.create',
      challenge: 'nonexistent-challenge-value',
      origin: 'https://example.com',
    });
    const badB64 = base64UrlEncode(new TextEncoder().encode(badClientData));

    const response = {
      id: base64UrlEncode(credentialId),
      rawId: base64UrlEncode(credentialId),
      type: 'public-key' as const,
      response: {
        clientDataJSON: badB64,
        attestationObject: attestationObjectB64,
      },
    };

    const result = await verifyRegistration(response, config);

    expect(result.success).toBe(false);
    expect(result.error).toContain('challenge');
  });

  it('returns success: false when rpId hash does not match', async () => {
    const { publicKeyCose, challenge } = await buildValidRegistrationData();

    // Build authData with WRONG rpId
    const { privateKey: _pk, publicKeyCose: _pk2 } = await generateTestKeyPair();
    const wrongAuthData = await buildAuthenticatorDataForRegistration(
      'evil.com', // wrong rpId
      new Uint8Array(16),
      publicKeyCose,
    );

    const clientDataJSON = JSON.stringify({
      type: 'webauthn.create',
      challenge,
      origin: 'https://example.com',
    });

    const attestationObject = encodeCBOR({
      fmt: 'none',
      attStmt: {},
      authData: wrongAuthData,
    });

    const response = {
      id: base64UrlEncode(new Uint8Array(16)),
      rawId: base64UrlEncode(new Uint8Array(16)),
      type: 'public-key' as const,
      response: {
        clientDataJSON: base64UrlEncode(new TextEncoder().encode(clientDataJSON)),
        attestationObject: base64UrlEncode(attestationObject),
      },
    };

    const result = await verifyRegistration(response, config);

    expect(result.success).toBe(false);
    expect(result.error).toContain('RP ID');
  });

  it('returns success: false when user-presence flag is not set', async () => {
    const { credentialId, publicKeyCose, challenge } = await buildValidRegistrationData();

    // flags without UP bit (0x01 not set) — only UV and AT
    const authData = await buildAuthenticatorDataForRegistration(
      'example.com',
      credIdBytes(),
      publicKeyCose,
      0,
      0x44, // AT | UV, no UP
    );

    const clientDataJSON = JSON.stringify({ type: 'webauthn.create', challenge, origin: 'https://example.com' });
    const attestationObject = encodeCBOR({ fmt: 'none', attStmt: {}, authData });

    const response = {
      id: base64UrlEncode(credentialId),
      rawId: base64UrlEncode(credentialId),
      type: 'public-key' as const,
      response: {
        clientDataJSON: base64UrlEncode(new TextEncoder().encode(clientDataJSON)),
        attestationObject: base64UrlEncode(attestationObject),
      },
    };

    const result = await verifyRegistration(response, config);
    expect(result.success).toBe(false);
    expect(result.error).toContain('User presence');
  });
});

function credIdBytes(): Uint8Array {
  const b = new Uint8Array(16);
  return b;
}

// ---------------------------------------------------------------------------
// generateAuthenticationOptions
// ---------------------------------------------------------------------------

describe('generateAuthenticationOptions', () => {
  it('returns the correct publicKey shape', async () => {
    const cb = makeCallbacks();
    const config = makeConfig(cb);

    const result = await generateAuthenticationOptions(config);

    expect(result).toHaveProperty('publicKey');
    const { publicKey } = result;
    expect(publicKey.rpId).toBe('example.com');
    expect(typeof publicKey.challenge).toBe('string');
    expect(publicKey.challenge.length).toBeGreaterThan(0);
    expect(publicKey.timeout).toBeGreaterThan(0);
    expect(publicKey.userVerification).toBe('required');
  });

  it('challenge is stored in callbacks with type authentication', async () => {
    const cb = makeCallbacks();
    const config = makeConfig(cb);

    const result = await generateAuthenticationOptions(config);
    const { challenge } = result.publicKey;

    expect(cb._challenges.has(challenge)).toBe(true);
    const stored = cb._challenges.get(challenge)!;
    expect(stored.type).toBe('authentication');
    expect(stored.expiresAt).toBeGreaterThan(Date.now());
  });

  it('challenge is base64url (no +/= characters)', async () => {
    const cb = makeCallbacks();
    const config = makeConfig(cb);

    const result = await generateAuthenticationOptions(config);
    expect(result.publicKey.challenge).not.toMatch(/[+/=]/);
  });

  it('returns different challenges on each call', async () => {
    const cb = makeCallbacks();
    const config = makeConfig(cb);

    const a = await generateAuthenticationOptions(config);
    const b = await generateAuthenticationOptions(config);

    expect(a.publicKey.challenge).not.toBe(b.publicKey.challenge);
  });

  it('populates allowCredentials when userId is provided', async () => {
    const cb = makeCallbacks();
    const config = makeConfig(cb);

    // Store a credential for user-1
    await cb.storeCredential({
      credentialId: 'cred-abc',
      publicKey: 'pk',
      signCount: 0,
      userId: 'user-1',
      createdAt: Date.now(),
    });

    const result = await generateAuthenticationOptions(config, 'user-1');

    expect(result.publicKey.allowCredentials).toBeDefined();
    expect(result.publicKey.allowCredentials).toHaveLength(1);
    expect(result.publicKey.allowCredentials![0].id).toBe('cred-abc');
    expect(result.publicKey.allowCredentials![0].type).toBe('public-key');
  });

  it('omits allowCredentials when no userId is provided', async () => {
    const cb = makeCallbacks();
    const config = makeConfig(cb);

    const result = await generateAuthenticationOptions(config);
    // allowCredentials should be undefined (not included) for usernameless flow
    expect(result.publicKey.allowCredentials).toBeUndefined();
  });

  it('stores userId in the challenge when userId is provided', async () => {
    const cb = makeCallbacks();
    const config = makeConfig(cb);

    const result = await generateAuthenticationOptions(config, 'user-1');
    const { challenge } = result.publicKey;
    const stored = cb._challenges.get(challenge)!;
    expect(stored.userId).toBe('user-1');
  });
});

// ---------------------------------------------------------------------------
// verifyAuthentication
// ---------------------------------------------------------------------------

describe('verifyAuthentication', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let config: PasskeyConfig;
  let privateKey: CryptoKey;
  let publicKeyCose: Uint8Array;
  let storedCredentialId: string;

  beforeEach(async () => {
    cb = makeCallbacks();
    config = makeConfig(cb);

    // Generate a real key pair and pre-store a credential
    const kp = await generateTestKeyPair();
    privateKey = kp.privateKey;
    publicKeyCose = kp.publicKeyCose;

    storedCredentialId = 'test-cred-id';
    await cb.storeCredential({
      credentialId: storedCredentialId,
      publicKey: base64UrlEncode(publicKeyCose),
      signCount: 0,
      userId: 'user-1',
      createdAt: Date.now(),
    });
  });

  async function buildValidAuthenticationData(signCount = 1): Promise<{
    challenge: string,
    clientDataJSONb64: string,
    authenticatorDataB64: string,
    signatureB64: string,
  }> {
    // Store a challenge
    const challengeBytes = new Uint8Array(32);
    crypto.getRandomValues(challengeBytes);
    const challenge = base64UrlEncode(challengeBytes);
    await cb.storeChallenge({
      challenge,
      userId: 'user-1',
      expiresAt: Date.now() + 300_000,
      type: 'authentication',
    });

    // Build authenticator data
    const authData = await buildAuthenticatorDataForAuthentication('example.com', signCount);
    const authenticatorDataB64 = base64UrlEncode(authData);

    // Build clientDataJSON
    const clientDataJSON = JSON.stringify({
      type: 'webauthn.get',
      challenge,
      origin: 'https://example.com',
      crossOrigin: false,
    });
    const clientDataJSONBytes = new TextEncoder().encode(clientDataJSON);
    const clientDataJSONb64 = base64UrlEncode(clientDataJSONBytes);

    // Sign: authData || sha256(clientDataJSON)
    const clientDataHash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', clientDataJSONBytes),
    );
    const signedData = new Uint8Array(authData.length + clientDataHash.length);
    signedData.set(authData);
    signedData.set(clientDataHash, authData.length);

    const sig = await signEcdsa(privateKey, signedData);
    const signatureB64 = base64UrlEncode(sig);

    return { challenge, clientDataJSONb64, authenticatorDataB64, signatureB64 };
  }

  it('returns success: true and the userId for a valid authentication', async () => {
    const { clientDataJSONb64, authenticatorDataB64, signatureB64 } = await buildValidAuthenticationData();

    const response = {
      id: storedCredentialId,
      rawId: storedCredentialId,
      type: 'public-key' as const,
      response: {
        clientDataJSON: clientDataJSONb64,
        authenticatorData: authenticatorDataB64,
        signature: signatureB64,
      },
    };

    const result = await verifyAuthentication(response, config);

    expect(result.success).toBe(true);
    expect(result.userId).toBe('user-1');
    expect(result.credentialId).toBe(storedCredentialId);
    expect(result.error).toBeUndefined();
  });

  it('increments sign count in updateCredential after successful authentication', async () => {
    const { clientDataJSONb64, authenticatorDataB64, signatureB64 } = await buildValidAuthenticationData(5);

    const response = {
      id: storedCredentialId,
      rawId: storedCredentialId,
      type: 'public-key' as const,
      response: {
        clientDataJSON: clientDataJSONb64,
        authenticatorData: authenticatorDataB64,
        signature: signatureB64,
      },
    };

    await verifyAuthentication(response, config);

    const updated = await cb.getCredentialById(storedCredentialId);
    expect(updated!.signCount).toBe(5);
    expect(updated!.lastUsedAt).toBeDefined();
  });

  it('returns success: false when credential is not found', async () => {
    const { clientDataJSONb64, authenticatorDataB64, signatureB64 } = await buildValidAuthenticationData();

    const response = {
      id: 'nonexistent-credential-id',
      rawId: 'nonexistent-credential-id',
      type: 'public-key' as const,
      response: {
        clientDataJSON: clientDataJSONb64,
        authenticatorData: authenticatorDataB64,
        signature: signatureB64,
      },
    };

    const result = await verifyAuthentication(response, config);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Credential not found');
  });

  it('flags a non-increasing counter on a validly signed assertion as cloneWarning without rejecting', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // First set stored signCount to 10
      await cb.updateCredential(storedCredentialId, { signCount: 10 });

      // Build auth data with signCount=5 (less than stored) but a VALID signature.
      // Per WebAuthn §6.1.1 this is a cloning signal, not an auth failure —
      // hard-rejecting would permanently lock out restored-from-backup authenticators.
      const { clientDataJSONb64, authenticatorDataB64, signatureB64 } = await buildValidAuthenticationData(5);

      const response = {
        id: storedCredentialId,
        rawId: storedCredentialId,
        type: 'public-key' as const,
        response: {
          clientDataJSON: clientDataJSONb64,
          authenticatorData: authenticatorDataB64,
          signature: signatureB64,
        },
      };

      const result = await verifyAuthentication(response, config);

      expect(result.success).toBe(true);
      expect(result.cloneWarning).toBe(true);
      expect(warnSpy).toHaveBeenCalledOnce();

      // Stored counter is monotonic: never decreased by a regressed assertion
      const updated = await cb.getCredentialById(storedCredentialId);
      expect(updated!.signCount).toBe(10);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not set cloneWarning on a normal increasing counter', async () => {
    const { clientDataJSONb64, authenticatorDataB64, signatureB64 } = await buildValidAuthenticationData(1);

    const response = {
      id: storedCredentialId,
      rawId: storedCredentialId,
      type: 'public-key' as const,
      response: {
        clientDataJSON: clientDataJSONb64,
        authenticatorData: authenticatorDataB64,
        signature: signatureB64,
      },
    };

    const result = await verifyAuthentication(response, config);
    expect(result.success).toBe(true);
    expect(result.cloneWarning).toBeUndefined();
  });

  it('a forged assertion with a max-value counter cannot mutate stored state or lock out the credential', async () => {
    // Forged assertion: huge counter, garbage signature
    const { clientDataJSONb64 } = await buildValidAuthenticationData(1);
    const forgedAuthData = await buildAuthenticatorDataForAuthentication('example.com', 0xffffffff);

    const forged = {
      id: storedCredentialId,
      rawId: storedCredentialId,
      type: 'public-key' as const,
      response: {
        clientDataJSON: clientDataJSONb64,
        authenticatorData: base64UrlEncode(forgedAuthData),
        signature: base64UrlEncode(new Uint8Array(64)),
      },
    };

    const forgedResult = await verifyAuthentication(forged, config);
    expect(forgedResult.success).toBe(false);

    // A failed signature must never mutate stored state
    const afterForged = await cb.getCredentialById(storedCredentialId);
    expect(afterForged!.signCount).toBe(0);

    // The legitimate authenticator still works afterwards
    const { clientDataJSONb64: cd, authenticatorDataB64, signatureB64 } = await buildValidAuthenticationData(1);
    const legit = {
      id: storedCredentialId,
      rawId: storedCredentialId,
      type: 'public-key' as const,
      response: {
        clientDataJSON: cd,
        authenticatorData: authenticatorDataB64,
        signature: signatureB64,
      },
    };

    const legitResult = await verifyAuthentication(legit, config);
    expect(legitResult.success).toBe(true);
    expect(legitResult.cloneWarning).toBeUndefined();
  });

  it('returns success: false when origin does not match', async () => {
    const { challenge } = await buildValidAuthenticationData();

    // Use the challenge that was stored but craft different clientDataJSON
    // (The challenge was consumed by buildValidAuthenticationData — re-store it)
    await cb.storeChallenge({
      challenge,
      userId: 'user-1',
      expiresAt: Date.now() + 300_000,
      type: 'authentication',
    });

    const badClientData = JSON.stringify({
      type: 'webauthn.get',
      challenge,
      origin: 'https://evil.com',
    });
    const authData = await buildAuthenticatorDataForAuthentication('example.com', 1);
    const clientDataJSONBytes = new TextEncoder().encode(badClientData);
    const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSONBytes));
    const signedData = new Uint8Array(authData.length + clientDataHash.length);
    signedData.set(authData);
    signedData.set(clientDataHash, authData.length);
    const sig = await signEcdsa(privateKey, signedData);

    const response = {
      id: storedCredentialId,
      rawId: storedCredentialId,
      type: 'public-key' as const,
      response: {
        clientDataJSON: base64UrlEncode(clientDataJSONBytes),
        authenticatorData: base64UrlEncode(authData),
        signature: base64UrlEncode(sig),
      },
    };

    const result = await verifyAuthentication(response, config);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Origin mismatch');
  });

  it('returns success: false for invalid signature', async () => {
    const { clientDataJSONb64, authenticatorDataB64 } = await buildValidAuthenticationData();

    // Use a garbage signature
    const badSig = base64UrlEncode(new Uint8Array(64));

    const response = {
      id: storedCredentialId,
      rawId: storedCredentialId,
      type: 'public-key' as const,
      response: {
        clientDataJSON: clientDataJSONb64,
        authenticatorData: authenticatorDataB64,
        signature: badSig,
      },
    };

    const result = await verifyAuthentication(response, config);
    expect(result.success).toBe(false);
    // Either invalid signature or error thrown internally
    expect(result.error).toBeTruthy();
  });

  it('returns success: false when rpId hash does not match', async () => {
    // Build authData with a wrong rpId
    const challengeBytes = new Uint8Array(32);
    crypto.getRandomValues(challengeBytes);
    const challenge = base64UrlEncode(challengeBytes);
    await cb.storeChallenge({
      challenge,
      userId: 'user-1',
      expiresAt: Date.now() + 300_000,
      type: 'authentication',
    });

    const wrongAuthData = await buildAuthenticatorDataForAuthentication('evil.com', 1);
    const clientDataJSON = JSON.stringify({ type: 'webauthn.get', challenge, origin: 'https://example.com' });
    const clientDataJSONBytes = new TextEncoder().encode(clientDataJSON);
    const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSONBytes));
    const signedData = new Uint8Array(wrongAuthData.length + clientDataHash.length);
    signedData.set(wrongAuthData);
    signedData.set(clientDataHash, wrongAuthData.length);
    const sig = await signEcdsa(privateKey, signedData);

    const response = {
      id: storedCredentialId,
      rawId: storedCredentialId,
      type: 'public-key' as const,
      response: {
        clientDataJSON: base64UrlEncode(clientDataJSONBytes),
        authenticatorData: base64UrlEncode(wrongAuthData),
        signature: base64UrlEncode(sig),
      },
    };

    const result = await verifyAuthentication(response, config);
    expect(result.success).toBe(false);
    expect(result.error).toContain('RP ID');
  });

  it('a consumed challenge cannot be replayed', async () => {
    const { clientDataJSONb64, authenticatorDataB64, signatureB64 } = await buildValidAuthenticationData(1);

    const response = {
      id: storedCredentialId,
      rawId: storedCredentialId,
      type: 'public-key' as const,
      response: {
        clientDataJSON: clientDataJSONb64,
        authenticatorData: authenticatorDataB64,
        signature: signatureB64,
      },
    };

    const first = await verifyAuthentication(response, config);
    expect(first.success).toBe(true);

    const replay = await verifyAuthentication(response, config);
    expect(replay.success).toBe(false);
    expect(replay.error).toContain('challenge');
  });

  it('rejects an assertion when the challenge is bound to a different user', async () => {
    // Challenge issued for user-2, but the assertion uses user-1's credential
    const challengeBytes = new Uint8Array(32);
    crypto.getRandomValues(challengeBytes);
    const challenge = base64UrlEncode(challengeBytes);
    await cb.storeChallenge({
      challenge,
      userId: 'user-2',
      expiresAt: Date.now() + 300_000,
      type: 'authentication',
    });

    const authData = await buildAuthenticatorDataForAuthentication('example.com', 1);
    const clientDataJSONBytes = new TextEncoder().encode(
      JSON.stringify({ type: 'webauthn.get', challenge, origin: 'https://example.com' }),
    );
    const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSONBytes));
    const signedData = new Uint8Array(authData.length + clientDataHash.length);
    signedData.set(authData);
    signedData.set(clientDataHash, authData.length);
    const sig = await signEcdsa(privateKey, signedData);

    const response = {
      id: storedCredentialId,
      rawId: storedCredentialId,
      type: 'public-key' as const,
      response: {
        clientDataJSON: base64UrlEncode(clientDataJSONBytes),
        authenticatorData: base64UrlEncode(authData),
        signature: base64UrlEncode(sig),
      },
    };

    const result = await verifyAuthentication(response, config);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Credential does not belong to the challenged user');
  });

  it('rejects a malformed base64url signature instead of decoding garbage', async () => {
    const { clientDataJSONb64, authenticatorDataB64 } = await buildValidAuthenticationData(1);

    const response = {
      id: storedCredentialId,
      rawId: storedCredentialId,
      type: 'public-key' as const,
      response: {
        clientDataJSON: clientDataJSONb64,
        authenticatorData: authenticatorDataB64,
        signature: '!!!not base64url!!!',
      },
    };

    const result = await verifyAuthentication(response, config);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid base64url input');
  });
});

// ---------------------------------------------------------------------------
// COSE key building helpers (integer keys, which encodeCBOR above cannot emit)
// ---------------------------------------------------------------------------

function cborIntBytes(n: number): Uint8Array {
  if (n >= 0 && n < 24) return new Uint8Array([n]);
  if (n >= 0 && n < 256) return new Uint8Array([0x18, n]);
  if (n < 0) {
    const v = -1 - n;
    if (v < 24) return new Uint8Array([0x20 | v]);
    if (v < 256) return new Uint8Array([0x38, v]);
    if (v < 65536) return new Uint8Array([0x39, v >> 8, v & 0xff]);
  }
  throw new Error('int out of range');
}

function cborByteString(b: Uint8Array): Uint8Array {
  let header: Uint8Array;
  if (b.length < 24) header = new Uint8Array([0x40 | b.length]);
  else if (b.length < 256) header = new Uint8Array([0x58, b.length]);
  else header = new Uint8Array([0x59, b.length >> 8, b.length & 0xff]);
  const result = new Uint8Array(header.length + b.length);
  result.set(header);
  result.set(b, header.length);
  return result;
}

/** Build a CBOR map with integer keys, as used by COSE keys */
function buildCoseKey(entries: Array<[number, number | Uint8Array]>): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0xa0 | entries.length])];
  for (const [key, value] of entries) {
    parts.push(cborIntBytes(key));
    parts.push(value instanceof Uint8Array ? cborByteString(value) : cborIntBytes(value));
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Whether this runtime's WebCrypto supports Ed25519 (Node >= 18.4, workerd, Deno, Bun) */
const ed25519Supported = await (async () => {
  try {
    await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
    return true;
  } catch {
    return false;
  }
})();

// ---------------------------------------------------------------------------
// CBOR decoder hardening (pre-auth DoS surface)
// ---------------------------------------------------------------------------

describe('CBOR decoder hardening', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let config: PasskeyConfig;

  beforeEach(() => {
    cb = makeCallbacks();
    config = makeConfig(cb);
  });

  /** Run verifyRegistration with valid client data but attacker-crafted attestation bytes */
  async function attemptWithAttestation(attestationBytes: Uint8Array): Promise<{ success: boolean, error?: string }> {
    const challengeBytes = new Uint8Array(32);
    crypto.getRandomValues(challengeBytes);
    const challenge = base64UrlEncode(challengeBytes);
    await cb.storeChallenge({
      challenge,
      userId: 'user-1',
      expiresAt: Date.now() + 300_000,
      type: 'registration',
    });

    const clientDataJSON = JSON.stringify({ type: 'webauthn.create', challenge, origin: 'https://example.com' });

    return verifyRegistration({
      id: 'attacker-cred',
      rawId: 'attacker-cred',
      type: 'public-key',
      response: {
        clientDataJSON: base64UrlEncode(new TextEncoder().encode(clientDataJSON)),
        attestationObject: base64UrlEncode(attestationBytes),
      },
    }, config);
  }

  it('rejects a tiny input declaring a ~4-billion-element array quickly, without hanging or allocating', async () => {
    // 0x9a = array with 32-bit length, declared length 0xffffffff — 5 bytes total
    const start = Date.now();
    const result = await attemptWithAttestation(new Uint8Array([0x9a, 0xff, 0xff, 0xff, 0xff]));
    const elapsedMs = Date.now() - start;

    expect(result.success).toBe(false);
    expect(result.error).toContain('CBOR');
    expect(elapsedMs).toBeLessThan(1000);
  });

  it('rejects a tiny input declaring a ~4-billion-entry map quickly', async () => {
    // 0xba = map with 32-bit length
    const start = Date.now();
    const result = await attemptWithAttestation(new Uint8Array([0xba, 0xff, 0xff, 0xff, 0xff]));
    const elapsedMs = Date.now() - start;

    expect(result.success).toBe(false);
    expect(result.error).toContain('CBOR');
    expect(elapsedMs).toBeLessThan(1000);
  });

  it('rejects a declared collection length that exceeds the remaining input', async () => {
    // 0x98 0x64 = array of 100 elements, but no content follows
    const result = await attemptWithAttestation(new Uint8Array([0x98, 0x64]));
    expect(result.success).toBe(false);
    expect(result.error).toContain('CBOR');
  });

  it('rejects a byte string whose declared length exceeds the input', async () => {
    // 0x5a = byte string with 32-bit length, claims 65536 bytes, none follow
    const result = await attemptWithAttestation(new Uint8Array([0x5a, 0x00, 0x01, 0x00, 0x00]));
    expect(result.success).toBe(false);
    expect(result.error).toContain('CBOR data truncated');
  });

  it('rejects deeply nested CBOR (stack exhaustion guard)', async () => {
    // Twenty nested single-element arrays: 0x81 x20 then 0x00
    const nested = new Uint8Array(21).fill(0x81);
    nested[20] = 0x00;
    const result = await attemptWithAttestation(nested);
    expect(result.success).toBe(false);
    expect(result.error).toContain('CBOR nesting too deep');
  });

  it('rejects truncated input instead of decoding garbage', async () => {
    // Map of 2 entries but input ends after the header
    const result = await attemptWithAttestation(new Uint8Array([0xa2, 0x01]));
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Algorithm agreement: advertised set === verifiable set
// ---------------------------------------------------------------------------

describe('algorithm support agreement', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let config: PasskeyConfig;

  beforeEach(() => {
    cb = makeCallbacks();
    config = makeConfig(cb);
  });

  async function storeRegistrationChallenge(): Promise<string> {
    const challengeBytes = new Uint8Array(32);
    crypto.getRandomValues(challengeBytes);
    const challenge = base64UrlEncode(challengeBytes);
    await cb.storeChallenge({
      challenge,
      userId: 'user-1',
      expiresAt: Date.now() + 300_000,
      type: 'registration',
    });
    return challenge;
  }

  async function registerWithCoseKey(
    publicKeyCose: Uint8Array,
    credentialId: Uint8Array,
  ): Promise<{ success: boolean, credentialId?: string, error?: string }> {
    const challenge = await storeRegistrationChallenge();
    const authData = await buildAuthenticatorDataForRegistration('example.com', credentialId, publicKeyCose);
    const clientDataJSON = JSON.stringify({ type: 'webauthn.create', challenge, origin: 'https://example.com' });
    const attestationObject = encodeCBOR({ fmt: 'none', attStmt: {}, authData });

    return verifyRegistration({
      id: base64UrlEncode(credentialId),
      rawId: base64UrlEncode(credentialId),
      type: 'public-key',
      response: {
        clientDataJSON: base64UrlEncode(new TextEncoder().encode(clientDataJSON)),
        attestationObject: base64UrlEncode(attestationObject),
      },
    }, config);
  }

  async function authenticate(
    credentialId: string,
    sign: (data: Uint8Array) => Promise<Uint8Array>,
    signCount = 1,
  ): Promise<{ success: boolean, userId?: string, error?: string }> {
    const challengeBytes = new Uint8Array(32);
    crypto.getRandomValues(challengeBytes);
    const challenge = base64UrlEncode(challengeBytes);
    await cb.storeChallenge({
      challenge,
      userId: 'user-1',
      expiresAt: Date.now() + 300_000,
      type: 'authentication',
    });

    const authData = await buildAuthenticatorDataForAuthentication('example.com', signCount);
    const clientDataJSONBytes = new TextEncoder().encode(
      JSON.stringify({ type: 'webauthn.get', challenge, origin: 'https://example.com' }),
    );
    const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSONBytes));
    const signedData = new Uint8Array(authData.length + clientDataHash.length);
    signedData.set(authData);
    signedData.set(clientDataHash, authData.length);

    return verifyAuthentication({
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      response: {
        clientDataJSON: base64UrlEncode(clientDataJSONBytes),
        authenticatorData: base64UrlEncode(authData),
        signature: base64UrlEncode(await sign(signedData)),
      },
    }, config);
  }

  it('advertises EdDSA (alg -8) exactly when the runtime can verify it', async () => {
    const result = await generateRegistrationOptions('user-1', config);
    const algs = result.publicKey.pubKeyCredParams.map(p => p.alg);
    expect(algs).toContain(-7);
    expect(algs).toContain(-257);
    expect(algs.includes(-8)).toBe(ed25519Supported);
  });

  it.runIf(ed25519Supported)('registers and authenticates an Ed25519 credential end-to-end', async () => {
    const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
    const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));

    // COSE OKP key: {1: 1 (OKP), 3: -8 (EdDSA), -1: 6 (Ed25519), -2: x}
    const cose = buildCoseKey([[1, 1], [3, -8], [-1, 6], [-2, publicKeyRaw]]);

    const credId = new Uint8Array(16);
    crypto.getRandomValues(credId);

    const registration = await registerWithCoseKey(cose, credId);
    expect(registration.success).toBe(true);

    const auth = await authenticate(
      registration.credentialId!,
      async data => new Uint8Array(await crypto.subtle.sign('Ed25519', keyPair.privateKey, data)),
    );
    expect(auth.success).toBe(true);
    expect(auth.userId).toBe('user-1');
  });

  it('registers and authenticates an RS384 credential using the COSE alg hash (not hardcoded SHA-256)', async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-384',
      },
      true,
      ['sign', 'verify'],
    );
    const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const n = base64UrlDecode(jwk.n!);
    const e = base64UrlDecode(jwk.e!);

    // COSE RSA key: {1: 3 (RSA), 3: -258 (RS384), -1: n, -2: e}
    const cose = buildCoseKey([[1, 3], [3, -258], [-1, n], [-2, e]]);

    const credId = new Uint8Array(16);
    crypto.getRandomValues(credId);

    const registration = await registerWithCoseKey(cose, credId);
    expect(registration.success).toBe(true);

    const auth = await authenticate(
      registration.credentialId!,
      async data => new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, data)),
    );
    expect(auth.success).toBe(true);
    expect(auth.userId).toBe('user-1');
  });

  it('rejects a credential with an unimplemented RSA algorithm (PS256) at registration time', async () => {
    // {1: 3, 3: -37 (PS256), -1: n, -2: e} — verifySignature cannot verify PSS
    const cose = buildCoseKey([[1, 3], [3, -37], [-1, new Uint8Array(8)], [-2, new Uint8Array(3)]]);
    const result = await registerWithCoseKey(cose, new Uint8Array(16));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported RSA algorithm');
    expect(cb._credentials.size).toBe(0);
  });

  it('rejects a credential with an unknown key type at registration time', async () => {
    const cose = buildCoseKey([[1, 5], [3, -7]]);
    const result = await registerWithCoseKey(cose, new Uint8Array(16));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported key type');
    expect(cb._credentials.size).toBe(0);
  });

  it('rejects a registration challenge that has no user binding', async () => {
    const challengeBytes = new Uint8Array(32);
    crypto.getRandomValues(challengeBytes);
    const challenge = base64UrlEncode(challengeBytes);
    await cb.storeChallenge({
      challenge,
      expiresAt: Date.now() + 300_000,
      type: 'registration',
    });

    const clientDataJSON = JSON.stringify({ type: 'webauthn.create', challenge, origin: 'https://example.com' });
    const result = await verifyRegistration({
      id: 'cred',
      rawId: 'cred',
      type: 'public-key',
      response: {
        clientDataJSON: base64UrlEncode(new TextEncoder().encode(clientDataJSON)),
        attestationObject: '',
      },
    }, config);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Challenge is not bound to a user');
  });
});
