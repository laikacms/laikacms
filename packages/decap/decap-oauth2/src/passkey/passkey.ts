/**
 * Passkey (WebAuthn) Authentication Module
 *
 * Implements FIDO2/WebAuthn passwordless authentication.
 * Works in both Cloudflare Workers and Node.js environments.
 *
 * @module @laikacms/decap-api/oauth2/passkey
 */

import { constantTimeEqualBuffer } from '@laikacms/crypto';

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
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256 (ECDSA with P-256)
        { type: 'public-key', alg: -257 }, // RS256 (RSASSA-PKCS1-v1_5 with SHA-256)
        { type: 'public-key', alg: -8 }, // EdDSA
      ],
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
  const { rpId, origin, callbacks } = config;

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

    // Extract credential data
    if (!parsedAuthData.attestedCredentialData) {
      return { success: false, error: 'No attested credential data' };
    }

    const { credentialId, publicKey, aaguid } = parsedAuthData.attestedCredentialData;

    // Store credential
    const credential: StoredCredential = {
      credentialId: base64UrlEncode(credentialId),
      publicKey: base64UrlEncode(publicKey),
      signCount: parsedAuthData.signCount,
      userId: storedChallenge.userId!,
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
 */
export async function verifyAuthentication(
  response: AuthenticationResponse,
  config: PasskeyConfig,
): Promise<{ success: boolean, userId?: string, credentialId?: string, error?: string }> {
  const { rpId, origin, callbacks } = config;

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

    // Verify sign count (replay attack prevention)
    if (parsedAuthData.signCount > 0 || credential.signCount > 0) {
      if (parsedAuthData.signCount <= credential.signCount) {
        // Possible cloned authenticator
        return { success: false, error: 'Sign count mismatch - possible cloned authenticator' };
      }
    }

    // Update credential
    await callbacks.updateCredential(credential.credentialId, {
      signCount: parsedAuthData.signCount,
      lastUsedAt: Date.now(),
    });

    return {
      success: true,
      userId: credential.userId,
      credentialId: credential.credentialId,
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
    // AAGUID (16 bytes)
    const aaguid = data.slice(offset, offset + 16);
    offset += 16;

    // Credential ID length (2 bytes, big-endian)
    const credentialIdLength = new DataView(data.buffer, data.byteOffset + offset, 2).getUint16(0, false);
    offset += 2;

    // Credential ID
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
 * Minimal CBOR decoder for attestation objects
 */
function decodeCBOR(data: Uint8Array): Record<string, unknown> {
  let offset = 0;

  function readByte(): number {
    return data[offset++];
  }

  function readBytes(length: number): Uint8Array {
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

  function decode(): unknown {
    const initial = readByte();
    const majorType = initial >> 5;
    const additionalInfo = initial & 0x1f;

    switch (majorType) {
      case 0: // Unsigned integer
        return readUint(additionalInfo);
      case 1: // Negative integer
        return -1 - readUint(additionalInfo);
      case 2: // Byte string
        const byteLength = readUint(additionalInfo);
        return readBytes(byteLength);
      case 3: // Text string
        const textLength = readUint(additionalInfo);
        return new TextDecoder().decode(readBytes(textLength));
      case 4: // Array
        const arrayLength = readUint(additionalInfo);
        const array: unknown[] = [];
        for (let i = 0; i < arrayLength; i++) {
          array.push(decode());
        }
        return array;
      case 5: // Map
        const mapLength = readUint(additionalInfo);
        const map: Record<string, unknown> = {};
        for (let i = 0; i < mapLength; i++) {
          const key = decode();
          const value = decode();
          map[String(key)] = value;
        }
        return map;
      case 7: // Simple/float
        if (additionalInfo === 20) return false;
        if (additionalInfo === 21) return true;
        if (additionalInfo === 22) return null;
        throw new Error('Unsupported CBOR simple value');
      default:
        throw new Error(`Unsupported CBOR major type: ${majorType}`);
    }
  }

  return decode() as Record<string, unknown>;
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

  if (kty === 2) {
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
    // RSA key
    const n = coseKey['-1'] as Uint8Array;
    const e = coseKey['-2'] as Uint8Array;

    const publicKey = await crypto.subtle.importKey(
      'jwk',
      {
        kty: 'RSA',
        n: base64UrlEncode(n),
        e: base64UrlEncode(e),
      },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
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
