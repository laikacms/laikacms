/**
 * Hash data using SHA-512 for post-quantum resistance.
 * SHA-512 provides 256-bit security against quantum attacks (Grover's algorithm).
 *
 * @param plain - Plain text to hash
 * @returns Base64url-encoded hash
 */
export async function sha512(plain: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  const hash = await crypto.subtle.digest('SHA-512', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Hash data using SHA-256 for PKCE compatibility.
 * Note: SHA-256 provides 128-bit security against quantum attacks.
 *
 * @param plain - Plain text to hash
 * @returns Base64url-encoded hash
 */
export async function sha256(plain: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Hash data using SHA-256 and return raw bytes.
 *
 * @param data - Data to hash (string or ArrayBuffer)
 * @returns Raw hash bytes
 */
export async function sha256Raw(data: string | ArrayBuffer): Promise<Uint8Array> {
  const input = typeof data === 'string' ? new TextEncoder().encode(data).buffer : data;
  const hash = await crypto.subtle.digest('SHA-256', input);
  return new Uint8Array(hash);
}

/**
 * Hash data using SHA-512 and return raw bytes.
 *
 * @param data - Data to hash (string or ArrayBuffer)
 * @returns Raw hash bytes
 */
export async function sha512Raw(data: string | ArrayBuffer): Promise<Uint8Array> {
  const input = typeof data === 'string' ? new TextEncoder().encode(data).buffer : data;
  const hash = await crypto.subtle.digest('SHA-512', input);
  return new Uint8Array(hash);
}
