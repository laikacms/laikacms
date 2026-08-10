// Runtime safety gate for the oauth2 package.
//
// The package advertises guarantees (CSPRNG-derived tokens, PKCE S256,
// constant-time comparison, WebAuthn) that some host runtimes cannot uphold.
// Where the ENVIRONMENT makes a guarantee impossible AND we can prove it from
// inside the process, the package must refuse to run rather than degrade
// silently. The operator can override per-reason via `ignoreUnsafeReasons`
// and then lives with a logged warning (see `suppressedReasons`).
//
// IMPORTANT — do NOT reintroduce `node:assert` (or any `node:*` import) here.
// This package is bundled for Cloudflare Workers, Deno, Bun and browsers,
// where a static `node:assert` import breaks the build and `process` may not
// exist. A conditional dynamic import is async and unusable in a sync
// constructor. `assertRuntimeSafety` IS the assertion: it throws
// `UnsafeRuntimeError` directly and depends on nothing but globals it probes
// defensively.

/**
 * Oldest Node.js major this package runs on — the oldest release line still
 * receiving upstream security fixes. Node 22 is in maintenance until
 * 2027-04-30; Node 20 reached end-of-life on 2026-04-30 and Node 21 on
 * 2024-06-01. Matches the `engines` field of packages/server/package.json.
 *
 * This floor is ONLY about security support, never about capability. Every
 * primitive the package needs is probed directly — CSPRNG_MISSING,
 * WEBCRYPTO_SUBTLE_MISSING, CSPRNG_DEGENERATE, SHA256_UNAVAILABLE,
 * HMAC_UNAVAILABLE and PASSKEY_ES256_UNAVAILABLE — which catches a deficient
 * runtime whatever version number it reports, and clears a capable one that
 * a version comparison would have rejected. Do not reintroduce version
 * checks as a proxy for feature detection.
 *
 * Raise this when the floor line reaches end-of-life, not when a new LTS ships.
 */
const NODE_SUPPORT_FLOOR = 22;

/** Hex encoding of 32 all-zero bytes; a CSPRNG must never produce this. */
const ALL_ZERO_SAMPLE_HEX = '0'.repeat(64);

/**
 * RFC 6979 (A.2.5) NIST P-256 test public key in raw uncompressed form
 * (0x04 || X || Y). Used only to prove that `crypto.subtle` can import and
 * verify ES256 keys — never for actual verification of user credentials.
 */
const P256_PROBE_PUBLIC_KEY_HEX = '04'
  + '60fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29fb6'
  + '7903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177a3c294d4462299';

/**
 * Immutable snapshot of the ambient runtime's cryptographic capabilities.
 * Captured once via {@link captureRuntimeProbe}; injectable for tests.
 */
export interface RuntimeProbe {
  /** `globalThis.crypto` exists. */
  readonly hasCrypto: boolean;
  /** `crypto.getRandomValues` exists and is a function. */
  readonly hasGetRandomValues: boolean;
  /** `crypto.subtle` exists. */
  readonly hasSubtle: boolean;
  /**
   * `globalThis.isSecureContext` when the runtime defines it as a boolean;
   * `undefined` on server runtimes — detectors must NOT fire on `undefined`.
   */
  readonly isSecureContext: boolean | undefined;
  /** Node.js major version, or `undefined` when not running on Node. */
  readonly nodeMajor: number | undefined;
  /** Hex of 32 random bytes, `undefined` if a sample could not be taken. */
  readonly randomSampleA: string | undefined;
  /** A second, independent 32-byte random sample (hex), or `undefined`. */
  readonly randomSampleB: string | undefined;
}

/** Operator-facing configuration relevant to the safety gate. */
export interface GateInput {
  /** Codes the operator explicitly suppresses, accepting the stated risk. */
  readonly ignoreUnsafeReasons?: readonly string[];
  /** Adversary model; `'post-quantum'` enables the PQ_* detectors. */
  readonly threatModel?: 'standard' | 'post-quantum';
  /** Whether passkey (WebAuthn) authentication is configured. */
  readonly passkeyEnabled: boolean;
  /** Whether TOTP authentication is configured. */
  readonly totpEnabled: boolean;
}

/** Registry entry describing one reason the runtime may be unsafe. */
export interface UnsafeReasonSpec {
  /** One-line human-readable summary. */
  readonly title: string;
  /** What the adversary gains if this condition is ignored. */
  readonly risk: string;
  /** What to do instead of overriding. */
  readonly remedy: string;
  /**
   * `'construct'` reasons are checked synchronously by
   * {@link assertRuntimeSafety}; `'first-request'` reasons require an await
   * and are checked by {@link assertRuntimeSafetyAsync}.
   */
  readonly when: 'construct' | 'first-request';
  /** Whether the operator may suppress this code via `ignoreUnsafeReasons`. */
  readonly ignorable: boolean;
  /** Returns `true` when the unsafe condition holds. */
  readonly detect: (probe: RuntimeProbe, input: GateInput) => boolean | Promise<boolean>;
}

/** Narrow accessor for the ambient SubtleCrypto, safe on any runtime. */
function liveSubtle(): SubtleCrypto | undefined {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  return cryptoObj?.subtle ?? undefined;
}

/**
 * Whether `code` names a live entry of {@link UNSAFE_REASONS}.
 * Explicitly annotated to break the type-inference cycle with the registry.
 */
function isKnownReason(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(UNSAFE_REASONS, code);
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Registry of every condition under which this package refuses to run.
 * Codes are permanent: never renamed, never reused — operators pin them in
 * `ignoreUnsafeReasons` and crash logs reference them for years.
 */
export const UNSAFE_REASONS = {
  LCMS_OAUTH2_CSPRNG_MISSING: {
    title: 'No cryptographically secure random number generator (crypto.getRandomValues)',
    risk:
      'Every authorization code, access token, refresh token, session id and PKCE verifier derives from crypto.getRandomValues; without it they would have to come from a predictable source and any session becomes forgeable.',
    remedy:
      'Run on a runtime that exposes the Web Crypto API (Node >= 22, Deno, Bun, Cloudflare Workers, or a modern browser). This package will never add a Math.random() fallback.',
    when: 'construct',
    ignorable: true,
    detect: probe => !probe.hasCrypto || !probe.hasGetRandomValues,
  },
  LCMS_OAUTH2_WEBCRYPTO_SUBTLE_MISSING: {
    title: 'Web Crypto SubtleCrypto is unavailable (crypto.subtle)',
    risk:
      'PKCE hashing, constant-time comparison, TOTP and passkey verification all bottom out in crypto.subtle; without it every cryptographic guarantee this package advertises is void.',
    remedy:
      'Run on a runtime that exposes crypto.subtle, or enable the embedding host’s native Web Crypto implementation instead of shimming it away.',
    when: 'construct',
    ignorable: true,
    detect: probe => !probe.hasSubtle,
  },
  LCMS_OAUTH2_CSPRNG_DEGENERATE: {
    title: 'The random number generator produced degenerate output',
    risk:
      'Two independent 32-byte samples were byte-identical or all-zero — a sound CSPRNG does that with probability ~2^-256, so this RNG is shimmed or unseeded and every token minted from it is predictable.',
    remedy:
      'Replace the crypto shim or unseeded embedded engine (QuickJS, Hermes, React Native polyfills) with a real platform CSPRNG.',
    when: 'construct',
    ignorable: true,
    detect: probe => {
      const { randomSampleA: a, randomSampleB: b } = probe;
      // If a sample could not be taken, do NOT fire — CSPRNG_MISSING covers that.
      if (a === ALL_ZERO_SAMPLE_HEX || b === ALL_ZERO_SAMPLE_HEX) return true;
      return a !== undefined && b !== undefined && a === b;
    },
  },
  LCMS_OAUTH2_INSECURE_CONTEXT: {
    title: 'Running in an insecure browser context (isSecureContext === false)',
    risk:
      'Without a secure context WebAuthn refuses to operate and bearer tokens travel over the network in cleartext, readable and replayable by any on-path attacker.',
    remedy:
      'Serve the application over HTTPS (or localhost during development) so the user agent grants a secure context.',
    when: 'construct',
    ignorable: true,
    // Must NOT fire when isSecureContext is undefined (every server runtime).
    detect: probe => probe.isSecureContext === false,
  },
  LCMS_OAUTH2_NODE_UNSUPPORTED: {
    title: 'Node.js has reached end-of-life (supported floor >= 22)',
    risk:
      'An end-of-life Node release receives no upstream security fixes, so a published vulnerability in its TLS, HTTP or crypto layer stays exploitable underneath this package for as long as the runtime is deployed — and nothing this package does can compensate for a hole below it.',
    remedy:
      "Upgrade to a Node.js release still receiving security updates (Node 22 or newer). This code is about patch support alone: it says nothing about the runtime's capabilities, which are probed separately.",
    when: 'construct',
    ignorable: true,
    detect: probe => probe.nodeMajor !== undefined && probe.nodeMajor < NODE_SUPPORT_FLOOR,
  },
  LCMS_OAUTH2_IGNORE_LIST_UNKNOWN_CODE: {
    title: 'ignoreUnsafeReasons contains an entry that matches no known code',
    risk:
      'A misspelled entry suppresses nothing while convincing you it did; an ignore list you cannot trust is worse than none.',
    remedy: 'Remove or correct the unknown entry. Valid codes are the keys of UNSAFE_REASONS exported by this module.',
    when: 'construct',
    ignorable: false,
    detect: (_probe, input) => (input.ignoreUnsafeReasons ?? []).some(code => !isKnownReason(code)),
  },
  LCMS_OAUTH2_SHA256_UNAVAILABLE: {
    title: 'SubtleCrypto cannot compute SHA-256 digests',
    risk:
      'PKCE S256 challenges can neither be created nor verified — S256 is the only supported challenge method, and downgrading to "plain" would let an intercepting attacker replay authorization codes.',
    remedy: 'Use a runtime whose crypto.subtle.digest supports SHA-256; do not substitute a JavaScript hash polyfill.',
    when: 'first-request',
    ignorable: true,
    detect: async probe => {
      if (!probe.hasSubtle) return true;
      const subtle = liveSubtle();
      if (subtle === undefined) return true;
      try {
        await subtle.digest('SHA-256', new Uint8Array(32));
        return false;
      } catch {
        return true;
      }
    },
  },
  LCMS_OAUTH2_HMAC_UNAVAILABLE: {
    title: 'SubtleCrypto cannot generate or sign with HMAC-SHA-256',
    risk:
      'Every constant-time comparison in this package is built on HMAC-SHA-256; without it secret comparisons become timing oracles that leak tokens byte by byte.',
    remedy: 'Use a runtime whose crypto.subtle supports HMAC key generation and signing with SHA-256.',
    when: 'first-request',
    ignorable: true,
    detect: async probe => {
      if (!probe.hasSubtle) return true;
      const subtle = liveSubtle();
      if (subtle === undefined) return true;
      try {
        const key = await subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        await subtle.sign('HMAC', key, new Uint8Array(32));
        return false;
      } catch {
        return true;
      }
    },
  },
  LCMS_OAUTH2_PASSKEY_ES256_UNAVAILABLE: {
    title: 'SubtleCrypto cannot import or verify ECDSA P-256 (ES256) keys',
    risk:
      'Passkey assertions cannot be verified at all, so WebAuthn logins would either always fail or would have to be accepted without verification.',
    remedy: 'Disable passkeys for this deployment, or move to a runtime whose crypto.subtle supports ECDSA over P-256.',
    when: 'first-request',
    ignorable: true,
    detect: async (probe, input) => {
      if (!input.passkeyEnabled) return false;
      if (!probe.hasSubtle) return true;
      const subtle = liveSubtle();
      if (subtle === undefined) return true;
      try {
        const key = await subtle.importKey(
          'raw',
          hexToBytes(P256_PROBE_PUBLIC_KEY_HEX),
          { name: 'ECDSA', namedCurve: 'P-256' },
          false,
          ['verify'],
        );
        // A zero signature must verify as `false`, not reject; only a
        // rejection proves the algorithm itself is unavailable.
        await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, new Uint8Array(64), new Uint8Array(32));
        return false;
      } catch {
        return true;
      }
    },
  },
  LCMS_OAUTH2_PQ_PASSKEY_SIGNATURE: {
    title: 'Passkeys rely on Shor-breakable signatures under the post-quantum threat model',
    risk:
      'WebAuthn assertions are signed with ES256/RS256, both broken by Shor’s algorithm; a quantum-capable adversary forges passkey logins, and FIDO2 has no deployed post-quantum algorithm to migrate to.',
    remedy:
      'Under this threat model, disable passkeys and authenticate with high-entropy secrets instead — or suppress this code only once you have decided passkey forgery is inside your risk appetite.',
    when: 'construct',
    ignorable: true,
    detect: (_probe, input) => input.threatModel === 'post-quantum' && input.passkeyEnabled,
  },
  LCMS_OAUTH2_PQ_PASSWORD_ONLY: {
    title: 'Password-only authentication under the post-quantum threat model',
    risk:
      'Grover’s algorithm halves effective password entropy, and traffic recorded today decrypts retroactively once a quantum adversary arrives — a harvested password alone then grants full access.',
    remedy: 'Enable TOTP or passkeys as a second factor so a recovered password is not sufficient on its own.',
    when: 'construct',
    ignorable: true,
    detect: (_probe, input) => input.threatModel === 'post-quantum' && !input.totpEnabled && !input.passkeyEnabled,
  },
  LCMS_OAUTH2_PQ_TRANSPORT_UNVERIFIED: {
    title: 'Post-quantum transport security cannot be verified from inside the process',
    risk:
      'If your TLS termination does not negotiate a hybrid post-quantum key exchange, traffic recorded today — bearer tokens included — decrypts retroactively (harvest now, decrypt later).',
    remedy:
      'Verify that your TLS termination negotiates a hybrid post-quantum key exchange (e.g. X25519MLKEM768). We cannot see that from here: suppressing this code IS your attestation that it does.',
    when: 'construct',
    ignorable: true,
    detect: (_probe, input) => input.threatModel === 'post-quantum',
  },
} as const satisfies Record<string, UnsafeReasonSpec>;

/** A permanent, machine-readable code identifying one unsafe condition. */
export type UnsafeReason = keyof typeof UNSAFE_REASONS;

function reasonCodes(): readonly UnsafeReason[] {
  return Object.keys(UNSAFE_REASONS) as UnsafeReason[];
}

/**
 * Builds the refusal message. NEVER interpolate config values, secrets,
 * tokens, hostnames or user data here — crash logs travel.
 */
function formatRefusalMessage(codes: readonly UnsafeReason[]): string {
  const blocks = codes.map(code => {
    const spec: UnsafeReasonSpec = UNSAFE_REASONS[code];
    return `[${code}] ${spec.title}\n  Risk:   ${spec.risk}\n  Remedy: ${spec.remedy}`;
  });
  const ignorable = codes.filter(code => (UNSAFE_REASONS[code] as UnsafeReasonSpec).ignorable);
  let message = '@laikacms/server/oauth2 refused to start: this environment cannot uphold guarantees the package makes.'
    + '\n\n'
    + blocks.join('\n\n');
  if (ignorable.length > 0) {
    const list = ignorable.map(code => `'${code}'`).join(', ');
    message += `\n\nOverride only if you accept the risk:\n  laikaOauth2({ ..., ignoreUnsafeReasons: [${list}] })`;
  }
  return message;
}

/**
 * Thrown when the runtime cannot uphold the package's guarantees. Carries
 * every firing, unsuppressed code at once — one error listing four problems
 * beats four sequential deploys.
 */
export class UnsafeRuntimeError extends Error {
  /** All firing codes that were not suppressed. */
  readonly codes: readonly UnsafeReason[];

  constructor(codes: readonly UnsafeReason[]) {
    super(formatRefusalMessage(codes));
    this.name = 'UnsafeRuntimeError';
    this.codes = codes;
  }
}

/**
 * Captures an immutable snapshot of the ambient runtime's capabilities.
 * Touches only `globalThis` — safe on Node, Deno, Bun, Workers and browsers.
 */
export function captureRuntimeProbe(): RuntimeProbe {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  const hasCrypto = typeof cryptoObj === 'object' && cryptoObj !== null;
  const hasGetRandomValues = hasCrypto && typeof cryptoObj?.getRandomValues === 'function';
  const hasSubtle = hasCrypto && typeof cryptoObj?.subtle === 'object' && cryptoObj?.subtle !== null;

  const secureContext = (globalThis as { isSecureContext?: unknown }).isSecureContext;
  const isSecureContext = typeof secureContext === 'boolean' ? secureContext : undefined;

  // `process` may not exist outside Node; never touch it statically.
  const proc = (globalThis as { process?: { versions?: { node?: unknown } } }).process;
  const nodeVersion = proc?.versions?.node;
  let nodeMajor: number | undefined;
  if (typeof nodeVersion === 'string') {
    const major = Number.parseInt(nodeVersion.split('.')[0], 10);
    nodeMajor = Number.isFinite(major) ? major : undefined;
  }

  const sample = (): string | undefined => {
    if (!hasGetRandomValues || cryptoObj === undefined) return undefined;
    try {
      const bytes = cryptoObj.getRandomValues(new Uint8Array(32));
      return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return undefined;
    }
  };

  return {
    hasCrypto,
    hasGetRandomValues,
    hasSubtle,
    isSecureContext,
    nodeMajor,
    randomSampleA: sample(),
    randomSampleB: sample(),
  };
}

/**
 * Validates the ignore list before it is trusted for suppression. Unknown
 * entries throw immediately with the non-suppressible
 * `LCMS_OAUTH2_IGNORE_LIST_UNKNOWN_CODE`.
 */
function assertIgnoreListTrustworthy(input: GateInput): void {
  if ((input.ignoreUnsafeReasons ?? []).some(code => !isKnownReason(code))) {
    throw new UnsafeRuntimeError(['LCMS_OAUTH2_IGNORE_LIST_UNKNOWN_CODE']);
  }
}

/** Subtracts operator-suppressed codes; non-ignorable codes never subtract. */
function withoutSuppressed(fired: readonly UnsafeReason[], input: GateInput): UnsafeReason[] {
  const ignored = new Set(input.ignoreUnsafeReasons ?? []);
  return fired.filter(code => !((UNSAFE_REASONS[code] as UnsafeReasonSpec).ignorable && ignored.has(code)));
}

function firingConstructReasons(input: GateInput, probe: RuntimeProbe): UnsafeReason[] {
  const fired: UnsafeReason[] = [];
  for (const code of reasonCodes()) {
    const spec: UnsafeReasonSpec = UNSAFE_REASONS[code];
    if (spec.when !== 'construct') continue;
    // Construct-phase detectors are synchronous by contract; a stray Promise
    // (truthy but not `true`) must not fire.
    if (spec.detect(probe, input) === true) fired.push(code);
  }
  return fired;
}

async function firingFirstRequestReasons(input: GateInput, probe: RuntimeProbe): Promise<UnsafeReason[]> {
  const fired: UnsafeReason[] = [];
  for (const code of reasonCodes()) {
    const spec: UnsafeReasonSpec = UNSAFE_REASONS[code];
    if (spec.when !== 'first-request') continue;
    if ((await spec.detect(probe, input)) === true) fired.push(code);
  }
  return fired;
}

/**
 * Synchronous safety gate covering every `when: 'construct'` reason. Call it
 * from the package constructor; it throws {@link UnsafeRuntimeError} with all
 * firing, unsuppressed codes at once. This function IS the assertion — it
 * deliberately does not import `node:assert` (see module comment).
 */
export function assertRuntimeSafety(input: GateInput, probe: RuntimeProbe = captureRuntimeProbe()): void {
  assertIgnoreListTrustworthy(input);
  const remaining = withoutSuppressed(firingConstructReasons(input, probe), input);
  if (remaining.length > 0) {
    throw new UnsafeRuntimeError(remaining);
  }
}

/**
 * Asynchronous safety gate covering every `when: 'first-request'` reason
 * (those that must await SubtleCrypto). Call it before serving the first
 * request; rejects with {@link UnsafeRuntimeError} carrying all firing,
 * unsuppressed codes at once.
 */
export async function assertRuntimeSafetyAsync(
  input: GateInput,
  probe: RuntimeProbe = captureRuntimeProbe(),
): Promise<void> {
  assertIgnoreListTrustworthy(input);
  const remaining = withoutSuppressed(await firingFirstRequestReasons(input, probe), input);
  if (remaining.length > 0) {
    throw new UnsafeRuntimeError(remaining);
  }
}

/**
 * Returns the `when: 'construct'` codes that fire on this runtime but were
 * suppressed by the operator. The caller should warn about each through its
 * own logger; this module never logs.
 */
export function suppressedReasons(input: GateInput, probe: RuntimeProbe = captureRuntimeProbe()): UnsafeReason[] {
  const ignored = new Set(input.ignoreUnsafeReasons ?? []);
  return firingConstructReasons(input, probe).filter(
    code => (UNSAFE_REASONS[code] as UnsafeReasonSpec).ignorable && ignored.has(code),
  );
}

/**
 * Async counterpart of {@link suppressedReasons} covering the
 * `when: 'first-request'` codes.
 */
export async function suppressedReasonsAsync(
  input: GateInput,
  probe: RuntimeProbe = captureRuntimeProbe(),
): Promise<UnsafeReason[]> {
  const ignored = new Set(input.ignoreUnsafeReasons ?? []);
  return (await firingFirstRequestReasons(input, probe)).filter(
    code => (UNSAFE_REASONS[code] as UnsafeReasonSpec).ignorable && ignored.has(code),
  );
}
