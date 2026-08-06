/**
 * Passkey (WebAuthn) Authentication Module
 *
 * Implements FIDO2/WebAuthn passwordless authentication.
 * Works in both Cloudflare Workers and Node.js environments.
 *
 * @module @laikacms/decap-api/oauth2/passkey
 */

import { constantTimeEqualBuffer } from 'laikacms/crypto';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Base64URL encoding/decoding utilities
 */
function base64UrlEncode(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64UrlDecode(str: string): Uint8Array {
  // Reject malformed input explicitly: some atob() implementations (notably
  // Node's Buffer-backed one) silently ignore invalid characters, which would
  // turn garbage into silently-wrong bytes instead of a verification error.
  if (!/^[A-Za-z0-9_-]*$/.test(str) || str.length % 4 === 1) {
    throw new Error('Invalid base64url input');
  }
  // Add padding if needed
  let padded = str.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) {
    padded += '=';
  }
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Known-valid Ed25519 public key (RFC 8032 test vector 1), used only to probe
 * whether the runtime's WebCrypto implementation supports Ed25519.
 */
// dprint-ignore
const ED25519_PROBE_KEY = new Uint8Array([
  0xd7, 0x5a, 0x98, 0x01, 0x82, 0xb1, 0x0a, 0xb7, 0xd5, 0x4b, 0xfe, 0xd3, 0xc9, 0x64, 0x07, 0x3a,
  0x0e, 0xe1, 0x72, 0xf3, 0xda, 0xa6, 0x23, 0x25, 0xaf, 0x02, 0x1a, 0x68, 0xf7, 0x07, 0x51, 0x1a,
]);

let ed25519SupportPromise: Promise<boolean> | undefined;

/**
 * Check whether this runtime's WebCrypto supports Ed25519 verification.
 * Cached after the first probe. Used to keep the advertised algorithm set
 * (`pubKeyCredParams`) in agreement with what `verifySignature` can verify:
 * a credential we cannot verify must never be offered or stored, because with
 * `passkey.required` it would permanently lock the user out.
 */
function supportsEd25519(): Promise<boolean> {
  ed25519SupportPromise ??= (async () => {
    try {
      await crypto.subtle.importKey('raw', ED25519_PROBE_KEY, { name: 'Ed25519' }, false, ['verify']);
      return true;
    } catch {
      return false;
    }
  })();
  return ed25519SupportPromise;
}

/**
 * Stored credential for a user's passkey
 */
export interface StoredCredential {
  /** Unique credential ID (base64url encoded) */
  credentialId: string;
  /** Public key in COSE format (base64url encoded) */
  publicKey: string;
  /** Signature counter for replay attack prevention */
  signCount: number;
  /** User ID this credential belongs to */
  userId: string;
  /** Credential creation timestamp */
  createdAt: number;
  /** Last used timestamp */
  lastUsedAt?: number;
  /** User-friendly name for the credential */
  name?: string;
  /** Authenticator AAGUID (identifies the authenticator type) */
  aaguid?: string;
  /** Whether this is a platform authenticator (built-in) or cross-platform (security key) */
  authenticatorType?: 'platform' | 'cross-platform';
}

/**
 * Challenge data stored during registration/authentication
 */
export interface StoredChallenge {
  /** The challenge value (base64url encoded) */
  challenge: string;
  /** User ID (for registration) or null (for authentication) */
  userId?: string;
  /** Challenge expiration timestamp */
  expiresAt: number;
  /** Challenge type */
  type: 'registration' | 'authentication';
}

/**
 * Callbacks for passkey storage operations
 */
export interface PasskeyCallbacks {
  /** Store a credential */
  storeCredential(credential: StoredCredential): Promise<void>;

  /** Get credential by credential ID */
  getCredentialById(credentialId: string): Promise<StoredCredential | null>;

  /** Get all credentials for a user */
  getCredentialsByUserId(userId: string): Promise<StoredCredential[]>;

  /** Update credential (e.g., sign count) */
  updateCredential(credentialId: string, updates: Partial<StoredCredential>): Promise<void>;

  /** Delete a credential */
  deleteCredential(credentialId: string): Promise<void>;

  /** Store a challenge temporarily */
  storeChallenge(challenge: StoredChallenge): Promise<void>;

  /** Get and delete a challenge (one-time use) */
  consumeChallenge(challenge: string): Promise<StoredChallenge | null>;

  /** Get user by ID */
  getUserById(userId: string): Promise<{ id: string, email: string, name?: string } | null>;

  /** Get user by email */
  getUserByEmail(email: string): Promise<{ id: string, email: string, name?: string } | null>;

  /**
   * Store a pending passkey setup session (after password verification, before passkey registration).
   * This is separate from TOTP sessions to maintain clear security boundaries.
   */
  storePendingPasskeySetupSession(sessionId: string, userId: string, expiresAt: number): Promise<void>;

  /**
   * Get a pending passkey setup session.
   * Returns the userId if the session is valid and not expired, null otherwise.
   */
  getPendingPasskeySetupSession(sessionId: string): Promise<{ userId: string } | null>;
}

/**
 * Passkey configuration
 */
export interface PasskeyConfig {
  /** Relying Party ID (usually the domain, e.g., 'example.com') */
  rpId: string;

  /** Relying Party name (displayed to user) */
  rpName: string;

  /** Origin for verification (e.g., 'https://example.com') */
  origin: string;

  /** Callbacks for storage operations */
  callbacks: PasskeyCallbacks;

  /** Challenge expiration in seconds (default: 300 = 5 minutes) */
  challengeExpiration?: number;

  /** Require user verification (PIN/biometric) (default: true) */
  userVerification?: 'required' | 'preferred' | 'discouraged';

  /** Allowed authenticator types (default: both) */
  authenticatorAttachment?: 'platform' | 'cross-platform';

  /** Require resident key / discoverable credential (default: preferred) */
  residentKey?: 'required' | 'preferred' | 'discouraged';
}

// ============================================================================
// Registration (Attestation)
// ============================================================================

/**
 * Options returned to the client for navigator.credentials.create()
 */
export interface RegistrationOptions {
  publicKey: {
    challenge: string, // base64url
    rp: {
      id: string,
      name: string,
    },
    user: {
      id: string, // base64url
      name: string,
      displayName: string,
    },
    pubKeyCredParams: Array<{
      type: 'public-key',
      alg: number,
    }>,
    timeout: number,
    attestation: 'none' | 'indirect' | 'direct',
    authenticatorSelection: {
      authenticatorAttachment?: 'platform' | 'cross-platform',
      residentKey: 'required' | 'preferred' | 'discouraged',
      userVerification: 'required' | 'preferred' | 'discouraged',
    },
    excludeCredentials: Array<{
      type: 'public-key',
      id: string, // base64url
      transports?: Array<'usb' | 'nfc' | 'ble' | 'internal' | 'hybrid'>,
    }>,
  };
}

/**
 * Generate registration options for a user
 */
export async function generateRegistrationOptions(
  userId: string,
  config: PasskeyConfig,
): Promise<RegistrationOptions> {
  const {
    rpId,
    rpName,
    callbacks,
    challengeExpiration = 300,
    userVerification = 'required',
    authenticatorAttachment,
    residentKey = 'preferred',
  } = config;

  // Get user
  const user = await callbacks.getUserById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  // Generate challenge
  const challengeBytes = new Uint8Array(32);
  crypto.getRandomValues(challengeBytes);
  const challenge = base64UrlEncode(challengeBytes);

  // Store challenge
  await callbacks.storeChallenge({
    challenge,
    userId,
    expiresAt: Date.now() + challengeExpiration * 1000,
    type: 'registration',
  });

  // Get existing credentials to exclude
  const existingCredentials = await callbacks.getCredentialsByUserId(userId);
  const excludeCredentials = existingCredentials.map(cred => ({
    type: 'public-key' as const,
    id: cred.credentialId,
    transports: ['usb', 'nfc', 'ble', 'internal', 'hybrid'] as Array<'usb' | 'nfc' | 'ble' | 'internal' | 'hybrid'>,
  }));

  // Encode user ID
  const userIdBytes = new TextEncoder().encode(userId);
  const userIdBase64 = base64UrlEncode(userIdBytes);

  // Only advertise algorithms this runtime can actually verify. Advertising
  // EdDSA on a runtime without Ed25519 support would let an authenticator
  // enrol a credential that can never authenticate.
  const pubKeyCredParams: RegistrationOptions['publicKey']['pubKeyCredParams'] = [
    { type: 'public-key', alg: -7 }, // ES256 (ECDSA with P-256)
    { type: 'public-key', alg: -257 }, // RS256 (RSASSA-PKCS1-v1_5 with SHA-256)
  ];
  if (await supportsEd25519()) {
    pubKeyCredParams.push({ type: 'public-key', alg: -8 }); // EdDSA (Ed25519)
  }

  return {
    publicKey: {
      challenge,
      rp: {
        id: rpId,
        name: rpName,
      },
      user: {
        id: userIdBase64,
        name: user.email,
        displayName: user.name || user.email,
      },
      pubKeyCredParams,
      timeout: 60000, // 60 seconds
      attestation: 'none', // We don't need attestation for most use cases
      authenticatorSelection: {
        ...(authenticatorAttachment && { authenticatorAttachment }),
        residentKey,
        userVerification,
      },
      excludeCredentials,
    },
  };
}

/**
 * Registration response from the client
 */
export interface RegistrationResponse {
  id: string; // base64url credential ID
  rawId: string; // base64url
  type: 'public-key';
  response: {
    clientDataJSON: string, // base64url
    attestationObject: string, // base64url
  };
  authenticatorAttachment?: 'platform' | 'cross-platform';
}

/**
 * Verify registration response and store credential
 */
export async function verifyRegistration(
  response: RegistrationResponse,
  config: PasskeyConfig,
  credentialName?: string,
): Promise<{ success: boolean, credentialId?: string, error?: string }> {
  const { rpId, origin, callbacks, userVerification = 'required' } = config;

  try {
    // Decode client data
    const clientDataJSON = base64UrlDecode(response.response.clientDataJSON);
    const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));

    // Verify client data
    if (clientData.type !== 'webauthn.create') {
      return { success: false, error: 'Invalid client data type' };
    }

    // Verify origin
    if (clientData.origin !== origin) {
      return { success: false, error: 'Origin mismatch' };
    }

    // Consume and verify challenge
    const storedChallenge = await callbacks.consumeChallenge(clientData.challenge);
    if (!storedChallenge) {
      return { success: false, error: 'Invalid or expired challenge' };
    }

    if (storedChallenge.type !== 'registration') {
      return { success: false, error: 'Wrong challenge type' };
    }

    // A registration challenge must be bound to a user; never store a
    // credential with an undefined owner.
    if (!storedChallenge.userId) {
      return { success: false, error: 'Challenge is not bound to a user' };
    }

    if (storedChallenge.expiresAt < Date.now()) {
      return { success: false, error: 'Challenge expired' };
    }

    // Decode attestation object
    const attestationObject = base64UrlDecode(response.response.attestationObject);
    const attestation = decodeCBOR(attestationObject);

    // Extract authenticator data
    const authData = attestation.authData;
    if (!(authData instanceof Uint8Array)) {
      return { success: false, error: 'Invalid authenticator data' };
    }

    // Parse authenticator data
    const parsedAuthData = parseAuthenticatorData(authData);

    // Verify RP ID hash
    const rpIdHash = await sha256(new TextEncoder().encode(rpId));
    if (!await constantTimeEqualBuffer(parsedAuthData.rpIdHash, rpIdHash)) {
      return { success: false, error: 'RP ID hash mismatch' };
    }

    // Verify flags
    if (!parsedAuthData.flags.userPresent) {
      return { success: false, error: 'User presence flag not set' };
    }

    // RFC: when the relying party requires user verification, the authenticator
    // must report that user verification was performed (PIN/biometric).
    if (userVerification === 'required' && !parsedAuthData.flags.userVerified) {
      return { success: false, error: 'User verification required but not performed' };
    }

    // Extract credential data
    if (!parsedAuthData.attestedCredentialData) {
      return { success: false, error: 'No attested credential data' };
    }

    const { credentialId, publicKey, aaguid } = parsedAuthData.attestedCredentialData;

    // Reject credentials we can never verify (unsupported key type, curve or
    // algorithm) at registration time. Storing one would enrol a credential
    // that can never authenticate — permanent lockout under passkey.required.
    const keyError = await validateCredentialPublicKey(publicKey);
    if (keyError) {
      return { success: false, error: keyError };
    }

    // Store credential
    const credential: StoredCredential = {
      credentialId: base64UrlEncode(credentialId),
      publicKey: base64UrlEncode(publicKey),
      signCount: parsedAuthData.signCount,
      userId: storedChallenge.userId,
      createdAt: Date.now(),
      name: credentialName,
      aaguid: base64UrlEncode(aaguid),
      authenticatorType: response.authenticatorAttachment,
    };

    await callbacks.storeCredential(credential);

    return { success: true, credentialId: credential.credentialId };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Verification failed' };
  }
}

// ============================================================================
// Authentication (Assertion)
// ============================================================================

/**
 * Options returned to the client for navigator.credentials.get()
 */
export interface AuthenticationOptions {
  publicKey: {
    challenge: string, // base64url
    rpId: string,
    timeout: number,
    userVerification: 'required' | 'preferred' | 'discouraged',
    allowCredentials?: Array<{
      type: 'public-key',
      id: string, // base64url
      transports?: Array<'usb' | 'nfc' | 'ble' | 'internal' | 'hybrid'>,
    }>,
  };
}

/**
 * Generate authentication options
 *
 * @param userId - Optional user ID to limit to specific user's credentials
 */
export async function generateAuthenticationOptions(
  config: PasskeyConfig,
  userId?: string,
): Promise<AuthenticationOptions> {
  const {
    rpId,
    callbacks,
    challengeExpiration = 300,
    userVerification = 'required',
  } = config;

  // Generate challenge
  const challengeBytes = new Uint8Array(32);
  crypto.getRandomValues(challengeBytes);
  const challenge = base64UrlEncode(challengeBytes);

  // Store challenge
  await callbacks.storeChallenge({
    challenge,
    userId,
    expiresAt: Date.now() + challengeExpiration * 1000,
    type: 'authentication',
  });

  // Get allowed credentials if user ID provided
  let allowCredentials: AuthenticationOptions['publicKey']['allowCredentials'];
  if (userId) {
    const credentials = await callbacks.getCredentialsByUserId(userId);
    allowCredentials = credentials.map(cred => ({
      type: 'public-key' as const,
      id: cred.credentialId,
      transports: ['usb', 'nfc', 'ble', 'internal', 'hybrid'] as Array<'usb' | 'nfc' | 'ble' | 'internal' | 'hybrid'>,
    }));
  }

  return {
    publicKey: {
      challenge,
      rpId,
      timeout: 60000,
      userVerification,
      ...(allowCredentials && allowCredentials.length > 0 && { allowCredentials }),
    },
  };
}

/**
 * Authentication response from the client
 */
export interface AuthenticationResponse {
  id: string; // base64url credential ID
  rawId: string; // base64url
  type: 'public-key';
  response: {
    clientDataJSON: string, // base64url
    authenticatorData: string, // base64url
    signature: string, // base64url
    userHandle?: string, // base64url (user ID)
  };
}

/**
 * Verify authentication response
 *
 * Signature counter semantics (WebAuthn L2 §6.1.1): the counter is a cloning
 * *signal*, not an authentication gate. A signed assertion whose counter did
 * not increase (common for synced/backup-restored passkeys, and authenticators
 * that always report 0) still succeeds, but `cloneWarning` is set so callers
 * can feed it into risk scoring. The stored counter is only ever mutated after
 * the signature has verified, and is never decreased — so a forged assertion
 * can never poison the stored counter and lock the credential out.
 */
export async function verifyAuthentication(
  response: AuthenticationResponse,
  config: PasskeyConfig,
): Promise<{ success: boolean, userId?: string, credentialId?: string, error?: string, cloneWarning?: boolean }> {
  const { rpId, origin, callbacks, userVerification = 'required' } = config;

  try {
    // Get stored credential
    const credential = await callbacks.getCredentialById(response.id);
    if (!credential) {
      return { success: false, error: 'Credential not found' };
    }

    // Decode client data
    const clientDataJSON = base64UrlDecode(response.response.clientDataJSON);
    const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));

    // Verify client data
    if (clientData.type !== 'webauthn.get') {
      return { success: false, error: 'Invalid client data type' };
    }

    // Verify origin
    if (clientData.origin !== origin) {
      return { success: false, error: 'Origin mismatch' };
    }

    // Consume and verify challenge
    const storedChallenge = await callbacks.consumeChallenge(clientData.challenge);
    if (!storedChallenge) {
      return { success: false, error: 'Invalid or expired challenge' };
    }

    if (storedChallenge.type !== 'authentication') {
      return { success: false, error: 'Wrong challenge type' };
    }

    if (storedChallenge.expiresAt < Date.now()) {
      return { success: false, error: 'Challenge expired' };
    }

    // If the challenge was issued for a specific user, the asserted credential
    // must belong to that user — otherwise a challenge bound to user A could
    // be satisfied with any other user's credential.
    if (storedChallenge.userId && storedChallenge.userId !== credential.userId) {
      return { success: false, error: 'Credential does not belong to the challenged user' };
    }

    // Decode authenticator data
    const authData = base64UrlDecode(response.response.authenticatorData);
    const parsedAuthData = parseAuthenticatorData(authData);

    // Verify RP ID hash
    const rpIdHash = await sha256(new TextEncoder().encode(rpId));
    if (!await constantTimeEqualBuffer(parsedAuthData.rpIdHash, rpIdHash)) {
      return { success: false, error: 'RP ID hash mismatch' };
    }

    // Verify flags
    if (!parsedAuthData.flags.userPresent) {
      return { success: false, error: 'User presence flag not set' };
    }

    // When the relying party requires user verification, reject responses where
    // the authenticator did not perform it. Without this check the configured
    // `userVerification: 'required'` is a request, not an enforcement.
    if (userVerification === 'required' && !parsedAuthData.flags.userVerified) {
      return { success: false, error: 'User verification required but not performed' };
    }

    // Verify signature
    const clientDataHash = await sha256(clientDataJSON);
    const signedData = new Uint8Array(authData.length + clientDataHash.length);
    signedData.set(authData);
    signedData.set(clientDataHash, authData.length);

    const publicKey = base64UrlDecode(credential.publicKey);
    const signature = base64UrlDecode(response.response.signature);

    const isValid = await verifySignature(
      publicKey,
      signedData,
      signature,
    );

    if (!isValid) {
      return { success: false, error: 'Invalid signature' };
    }

    // Signature counter (WebAuthn L2 §6.1.1): a non-increasing counter on a
    // *validly signed* assertion is a cloning signal, not an authentication
    // failure. Rejecting here would permanently lock out legitimate users whose
    // authenticator was restored from backup or always reports 0. We surface it
    // as `cloneWarning` and never decrease the stored counter. This code runs
    // strictly after signature verification, so a forged assertion can never
    // mutate stored state.
    const counterInUse = parsedAuthData.signCount > 0 || credential.signCount > 0;
    const cloneWarning = counterInUse && parsedAuthData.signCount <= credential.signCount;
    if (cloneWarning) {
      console.warn(
        `Passkey sign count did not increase for credential ${credential.credentialId} `
          + `(stored ${credential.signCount}, received ${parsedAuthData.signCount}) - possible cloned authenticator`,
      );
    }

    // Update credential (counter is monotonic: never decreased)
    await callbacks.updateCredential(credential.credentialId, {
      signCount: Math.max(parsedAuthData.signCount, credential.signCount),
      lastUsedAt: Date.now(),
    });

    return {
      success: true,
      userId: credential.userId,
      credentialId: credential.credentialId,
      ...(cloneWarning && { cloneWarning }),
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Verification failed' };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert a Uint8Array to one with a guaranteed ArrayBuffer backing.
 * This is needed because Uint8Array.slice() returns Uint8Array<ArrayBufferLike>
 * which TypeScript considers incompatible with BufferSource.
 */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  // If the Uint8Array is a view into a larger buffer, extract just the relevant portion
  if (data.byteOffset !== 0 || data.byteLength !== data.buffer.byteLength) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  }
  return data.buffer as ArrayBuffer;
}

/**
 * SHA-256 hash
 */
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-256', toArrayBuffer(data));
  return new Uint8Array(hash);
}

/**
 * Parse authenticator data
 */
interface ParsedAuthenticatorData {
  rpIdHash: Uint8Array;
  flags: {
    userPresent: boolean,
    userVerified: boolean,
    attestedCredentialData: boolean,
    extensionData: boolean,
  };
  signCount: number;
  attestedCredentialData?: {
    aaguid: Uint8Array,
    credentialId: Uint8Array,
    publicKey: Uint8Array,
  };
}

function parseAuthenticatorData(data: Uint8Array): ParsedAuthenticatorData {
  // rpIdHash (32) + flags (1) + signCount (4)
  if (data.length < 37) {
    throw new Error('Authenticator data too short');
  }

  let offset = 0;

  // RP ID hash (32 bytes)
  const rpIdHash = data.slice(offset, offset + 32);
  offset += 32;

  // Flags (1 byte)
  const flags = data[offset];
  offset += 1;

  const parsedFlags = {
    userPresent: !!(flags & 0x01),
    userVerified: !!(flags & 0x04),
    attestedCredentialData: !!(flags & 0x40),
    extensionData: !!(flags & 0x80),
  };

  // Sign count (4 bytes, big-endian)
  const signCount = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, false);
  offset += 4;

  const result: ParsedAuthenticatorData = {
    rpIdHash,
    flags: parsedFlags,
    signCount,
  };

  // Attested credential data (if present)
  if (parsedFlags.attestedCredentialData) {
    // AAGUID (16 bytes) + credential ID length (2 bytes)
    if (data.length < offset + 18) {
      throw new Error('Attested credential data truncated');
    }

    // AAGUID (16 bytes)
    const aaguid = data.slice(offset, offset + 16);
    offset += 16;

    // Credential ID length (2 bytes, big-endian)
    const credentialIdLength = new DataView(data.buffer, data.byteOffset + offset, 2).getUint16(0, false);
    offset += 2;

    // Credential ID
    if (data.length < offset + credentialIdLength) {
      throw new Error('Attested credential data truncated');
    }
    const credentialId = data.slice(offset, offset + credentialIdLength);
    offset += credentialIdLength;

    // Public key (COSE format, remaining bytes until extensions)
    const publicKey = data.slice(offset);

    result.attestedCredentialData = {
      aaguid,
      credentialId,
      publicKey,
    };
  }

  return result;
}

/**
 * Maximum nesting depth accepted by the CBOR decoder. Attestation objects and
 * COSE keys are shallow (2-3 levels); deep nesting is only ever an attack.
 */
const CBOR_MAX_DEPTH = 8;

/**
 * Hard ceiling on declared CBOR collection sizes. Real attestation objects
 * and COSE keys contain a handful of entries; anything near this limit is
 * malformed or malicious.
 */
const CBOR_MAX_COLLECTION_LENGTH = 1024;

/**
 * Minimal CBOR decoder for attestation objects.
 *
 * Hardened against attacker-supplied input (this runs pre-authentication):
 * every declared length is capped against the remaining input size, collection
 * sizes have a hard ceiling, nesting depth is limited, and reads past the end
 * of input throw instead of yielding garbage.
 */
function decodeCBOR(data: Uint8Array): Record<string, unknown> {
  let offset = 0;

  function readByte(): number {
    if (offset >= data.length) {
      throw new Error('CBOR data truncated');
    }
    return data[offset++];
  }

  function readBytes(length: number): Uint8Array {
    if (length > data.length - offset) {
      throw new Error('CBOR data truncated');
    }
    const bytes = data.slice(offset, offset + length);
    offset += length;
    return bytes;
  }

  function readUint(additionalInfo: number): number {
    if (additionalInfo < 24) return additionalInfo;
    if (additionalInfo === 24) return readByte();
    if (additionalInfo === 25) {
      const bytes = readBytes(2);
      return new DataView(bytes.buffer, bytes.byteOffset, 2).getUint16(0, false);
    }
    if (additionalInfo === 26) {
      const bytes = readBytes(4);
      return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false);
    }
    throw new Error('Unsupported CBOR integer size');
  }

  /**
   * Read a collection length and validate it against the remaining input:
   * a collection of N entries needs at least N * minBytesPerEntry more bytes,
   * so a tiny input cannot declare a multi-billion-iteration loop.
   */
  function readCollectionLength(additionalInfo: number, minBytesPerEntry: number): number {
    const length = readUint(additionalInfo);
    if (length > CBOR_MAX_COLLECTION_LENGTH) {
      throw new Error('CBOR collection length exceeds limit');
    }
    if (length * minBytesPerEntry > data.length - offset) {
      throw new Error('CBOR collection length exceeds input size');
    }
    return length;
  }

  function decode(depth: number): unknown {
    if (depth > CBOR_MAX_DEPTH) {
      throw new Error('CBOR nesting too deep');
    }

    const initial = readByte();
    const majorType = initial >> 5;
    const additionalInfo = initial & 0x1f;

    switch (majorType) {
      case 0: { // Unsigned integer
        return readUint(additionalInfo);
      }
      case 1: { // Negative integer
        return -1 - readUint(additionalInfo);
      }
      case 2: { // Byte string
        const byteLength = readUint(additionalInfo);
        return readBytes(byteLength);
      }
      case 3: { // Text string
        const textLength = readUint(additionalInfo);
        return new TextDecoder().decode(readBytes(textLength));
      }
      case 4: { // Array
        const arrayLength = readCollectionLength(additionalInfo, 1);
        const array: unknown[] = [];
        for (let i = 0; i < arrayLength; i++) {
          array.push(decode(depth + 1));
        }
        return array;
      }
      case 5: { // Map
        const mapLength = readCollectionLength(additionalInfo, 2);
        const map: Record<string, unknown> = {};
        for (let i = 0; i < mapLength; i++) {
          const key = decode(depth + 1);
          const value = decode(depth + 1);
          map[String(key)] = value;
        }
        return map;
      }
      case 7: { // Simple/float
        if (additionalInfo === 20) return false;
        if (additionalInfo === 21) return true;
        if (additionalInfo === 22) return null;
        throw new Error('Unsupported CBOR simple value');
      }
      default:
        throw new Error(`Unsupported CBOR major type: ${majorType}`);
    }
  }

  return decode(0) as Record<string, unknown>;
}

/**
 * Map a COSE RSASSA-PKCS1-v1_5 algorithm identifier to its WebCrypto hash.
 * Returns undefined for algorithms we do not implement.
 */
function rsaHashForAlg(alg: number): string | undefined {
  if (alg === -257) return 'SHA-256'; // RS256
  if (alg === -258) return 'SHA-384'; // RS384
  if (alg === -259) return 'SHA-512'; // RS512
  return undefined;
}

/**
 * Validate a COSE public key at registration time.
 * Returns an error message when the key uses a type/curve/algorithm that
 * `verifySignature` cannot verify on this runtime, null when the key is usable.
 */
async function validateCredentialPublicKey(publicKeyCose: Uint8Array): Promise<string | null> {
  let coseKey: Record<string, unknown>;
  try {
    coseKey = decodeCBOR(publicKeyCose);
  } catch {
    return 'Malformed credential public key';
  }

  const kty = coseKey['1'] as number;
  const alg = coseKey['3'] as number;

  if (kty === 1) {
    // OKP (EdDSA)
    const crv = coseKey['-1'] as number;
    if (crv !== 6 || alg !== -8) {
      return `Unsupported OKP curve/algorithm: crv ${crv}, alg ${alg}`;
    }
    if (!(coseKey['-2'] instanceof Uint8Array)) {
      return 'Malformed OKP public key';
    }
    if (!(await supportsEd25519())) {
      return 'EdDSA is not supported by this runtime';
    }
    return null;
  }

  if (kty === 2) {
    // EC2 (ECDSA)
    const crv = coseKey['-1'] as number;
    if (crv !== 1 && crv !== 2 && crv !== 3) {
      return `Unsupported curve: ${crv}`;
    }
    if (alg !== -7 && alg !== -35 && alg !== -36) {
      return `Unsupported algorithm: ${alg}`;
    }
    if (!(coseKey['-2'] instanceof Uint8Array) || !(coseKey['-3'] instanceof Uint8Array)) {
      return 'Malformed EC2 public key';
    }
    return null;
  }

  if (kty === 3) {
    // RSA
    if (!rsaHashForAlg(alg)) {
      return `Unsupported RSA algorithm: ${alg}`;
    }
    if (!(coseKey['-1'] instanceof Uint8Array) || !(coseKey['-2'] instanceof Uint8Array)) {
      return 'Malformed RSA public key';
    }
    return null;
  }

  return `Unsupported key type: ${kty}`;
}

/**
 * Verify signature using WebCrypto
 */
async function verifySignature(
  publicKeyCose: Uint8Array,
  data: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  // Decode COSE public key
  const coseKey = decodeCBOR(publicKeyCose);

  // Get key type and algorithm
  const kty = coseKey['1'] as number; // Key type
  const alg = coseKey['3'] as number; // Algorithm

  if (kty === 1) {
    // OKP key (EdDSA / Ed25519)
    const crv = coseKey['-1'] as number; // Curve
    if (crv !== 6) {
      throw new Error(`Unsupported OKP curve: ${crv}`);
    }
    if (!(await supportsEd25519())) {
      throw new Error('EdDSA is not supported by this runtime');
    }
    const x = coseKey['-2'] as Uint8Array;

    const publicKey = await crypto.subtle.importKey(
      'raw',
      toArrayBuffer(x),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );

    return crypto.subtle.verify(
      'Ed25519',
      publicKey,
      toArrayBuffer(signature),
      toArrayBuffer(data),
    );
  } else if (kty === 2) {
    // EC2 key (ECDSA)
    const crv = coseKey['-1'] as number; // Curve
    const x = coseKey['-2'] as Uint8Array;
    const y = coseKey['-3'] as Uint8Array;

    // Determine curve
    let namedCurve: string;
    if (crv === 1) namedCurve = 'P-256';
    else if (crv === 2) namedCurve = 'P-384';
    else if (crv === 3) namedCurve = 'P-521';
    else throw new Error(`Unsupported curve: ${crv}`);

    // Import public key
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      {
        kty: 'EC',
        crv: namedCurve,
        x: base64UrlEncode(x),
        y: base64UrlEncode(y),
      },
      { name: 'ECDSA', namedCurve },
      false,
      ['verify'],
    );

    // Determine hash algorithm
    let hash: string;
    if (alg === -7) hash = 'SHA-256';
    else if (alg === -35) hash = 'SHA-384';
    else if (alg === -36) hash = 'SHA-512';
    else throw new Error(`Unsupported algorithm: ${alg}`);

    // Convert signature from DER to raw format if needed
    const rawSignature = derToRaw(signature, namedCurve);

    return crypto.subtle.verify(
      { name: 'ECDSA', hash },
      publicKey,
      toArrayBuffer(rawSignature),
      toArrayBuffer(data),
    );
  } else if (kty === 3) {
    // RSA key — honour the COSE `alg`; verifying RS384/RS512 with SHA-256
    // would silently mis-verify, so unknown algorithms are rejected instead.
    const n = coseKey['-1'] as Uint8Array;
    const e = coseKey['-2'] as Uint8Array;

    const hash = rsaHashForAlg(alg);
    if (!hash) {
      throw new Error(`Unsupported RSA algorithm: ${alg}`);
    }

    const publicKey = await crypto.subtle.importKey(
      'jwk',
      {
        kty: 'RSA',
        n: base64UrlEncode(n),
        e: base64UrlEncode(e),
      },
      { name: 'RSASSA-PKCS1-v1_5', hash },
      false,
      ['verify'],
    );

    return crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      toArrayBuffer(signature),
      toArrayBuffer(data),
    );
  }

  throw new Error(`Unsupported key type: ${kty}`);
}

/**
 * Convert DER-encoded ECDSA signature to raw format
 */
function derToRaw(signature: Uint8Array, curve: string): Uint8Array {
  // Check if already in raw format
  const componentLength = curve === 'P-256' ? 32 : curve === 'P-384' ? 48 : 66;
  if (signature.length === componentLength * 2) {
    return signature;
  }

  // Parse DER format
  if (signature[0] !== 0x30) {
    throw new Error('Invalid DER signature');
  }

  let offset = 2;

  // Read r
  if (signature[offset] !== 0x02) throw new Error('Invalid DER signature');
  offset++;
  const rLength = signature[offset++];
  let r = signature.slice(offset, offset + rLength);
  offset += rLength;

  // Read s
  if (signature[offset] !== 0x02) throw new Error('Invalid DER signature');
  offset++;
  const sLength = signature[offset++];
  let s = signature.slice(offset, offset + sLength);

  // Remove leading zeros and pad to component length
  while (r.length > componentLength && r[0] === 0) r = r.slice(1);
  while (s.length > componentLength && s[0] === 0) s = s.slice(1);

  const raw = new Uint8Array(componentLength * 2);
  raw.set(r, componentLength - r.length);
  raw.set(s, componentLength * 2 - s.length);

  return raw;
}
