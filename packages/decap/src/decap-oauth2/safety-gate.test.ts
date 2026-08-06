/**
 * Unit tests for the runtime safety gate (safety-gate.ts).
 *
 * Per code: fires against a faked probe when its condition holds, does not
 * fire when suppressed, and the message names the code. Plus two suite-level
 * tests that matter more than the rest: the HEALTHY-RUNTIME test (zero codes
 * fire against the real probe on this test runtime) and the REGISTRY
 * INTEGRITY test (code format, non-empty prose, exactly one non-ignorable).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GateInput, RuntimeProbe, UnsafeReason } from './safety-gate.js';
import {
  assertRuntimeSafety,
  assertRuntimeSafetyAsync,
  captureRuntimeProbe,
  suppressedReasons,
  suppressedReasonsAsync,
  UNSAFE_REASONS,
  UnsafeRuntimeError,
} from './safety-gate.js';

const HEX_A = 'a1'.repeat(32);
const HEX_B = 'b2'.repeat(32);
const ZERO_HEX = '0'.repeat(64);

function probe(overrides: Partial<RuntimeProbe> = {}): RuntimeProbe {
  return {
    hasCrypto: true,
    hasGetRandomValues: true,
    hasSubtle: true,
    isSecureContext: undefined,
    nodeMajor: 24,
    randomSampleA: HEX_A,
    randomSampleB: HEX_B,
    ...overrides,
  };
}

function input(overrides: Partial<GateInput> = {}): GateInput {
  return { passkeyEnabled: false, totpEnabled: false, ...overrides };
}

function syncCodes(gateInput: GateInput, gateProbe: RuntimeProbe): readonly UnsafeReason[] {
  try {
    assertRuntimeSafety(gateInput, gateProbe);
    return [];
  } catch (error) {
    if (error instanceof UnsafeRuntimeError) return error.codes;
    throw error;
  }
}

async function asyncCodes(gateInput: GateInput, gateProbe: RuntimeProbe): Promise<readonly UnsafeReason[]> {
  try {
    await assertRuntimeSafetyAsync(gateInput, gateProbe);
    return [];
  } catch (error) {
    if (error instanceof UnsafeRuntimeError) return error.codes;
    throw error;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LCMS_OAUTH2_CSPRNG_MISSING', () => {
  const badProbe = probe({ hasGetRandomValues: false, randomSampleA: undefined, randomSampleB: undefined });

  it('fires when crypto.getRandomValues is absent and the message names the code', () => {
    expect(syncCodes(input(), badProbe)).toContain('LCMS_OAUTH2_CSPRNG_MISSING');
    expect(() => assertRuntimeSafety(input(), badProbe)).toThrowError(/LCMS_OAUTH2_CSPRNG_MISSING/);
  });

  it('fires when globalThis.crypto itself is absent', () => {
    const noCrypto = probe({
      hasCrypto: false,
      hasGetRandomValues: false,
      hasSubtle: false,
      randomSampleA: undefined,
      randomSampleB: undefined,
    });
    expect(syncCodes(input(), noCrypto)).toContain('LCMS_OAUTH2_CSPRNG_MISSING');
  });

  it('does not fire when suppressed', () => {
    expect(() => assertRuntimeSafety(input({ ignoreUnsafeReasons: ['LCMS_OAUTH2_CSPRNG_MISSING'] }), badProbe)).not
      .toThrow();
  });
});

describe('LCMS_OAUTH2_WEBCRYPTO_SUBTLE_MISSING', () => {
  const badProbe = probe({ hasSubtle: false });

  it('fires when crypto.subtle is absent and the message names the code', () => {
    expect(syncCodes(input(), badProbe)).toContain('LCMS_OAUTH2_WEBCRYPTO_SUBTLE_MISSING');
    expect(() => assertRuntimeSafety(input(), badProbe)).toThrowError(/LCMS_OAUTH2_WEBCRYPTO_SUBTLE_MISSING/);
  });

  it('does not fire when suppressed', () => {
    expect(() =>
      assertRuntimeSafety(input({ ignoreUnsafeReasons: ['LCMS_OAUTH2_WEBCRYPTO_SUBTLE_MISSING'] }), badProbe)
    ).not.toThrow();
  });
});

describe('LCMS_OAUTH2_CSPRNG_DEGENERATE', () => {
  it('fires when both samples are byte-identical and the message names the code', () => {
    const badProbe = probe({ randomSampleA: HEX_A, randomSampleB: HEX_A });
    expect(syncCodes(input(), badProbe)).toContain('LCMS_OAUTH2_CSPRNG_DEGENERATE');
    expect(() => assertRuntimeSafety(input(), badProbe)).toThrowError(/LCMS_OAUTH2_CSPRNG_DEGENERATE/);
  });

  it('fires when either sample is all-zero', () => {
    expect(syncCodes(input(), probe({ randomSampleA: ZERO_HEX }))).toContain('LCMS_OAUTH2_CSPRNG_DEGENERATE');
    expect(syncCodes(input(), probe({ randomSampleB: ZERO_HEX }))).toContain('LCMS_OAUTH2_CSPRNG_DEGENERATE');
  });

  it('does not fire when a sample could not be taken (CSPRNG_MISSING covers that)', () => {
    expect(syncCodes(input(), probe({ randomSampleA: undefined }))).toEqual([]);
    expect(syncCodes(input(), probe({ randomSampleA: undefined, randomSampleB: undefined }))).toEqual([]);
  });

  it('does not fire when suppressed', () => {
    const badProbe = probe({ randomSampleA: HEX_A, randomSampleB: HEX_A });
    expect(() => assertRuntimeSafety(input({ ignoreUnsafeReasons: ['LCMS_OAUTH2_CSPRNG_DEGENERATE'] }), badProbe)).not
      .toThrow();
  });
});

describe('LCMS_OAUTH2_INSECURE_CONTEXT', () => {
  const badProbe = probe({ isSecureContext: false });

  it('fires when isSecureContext === false and the message names the code', () => {
    expect(syncCodes(input(), badProbe)).toContain('LCMS_OAUTH2_INSECURE_CONTEXT');
    expect(() => assertRuntimeSafety(input(), badProbe)).toThrowError(/LCMS_OAUTH2_INSECURE_CONTEXT/);
  });

  it('does not fire when isSecureContext is undefined (server runtimes)', () => {
    expect(syncCodes(input(), probe({ isSecureContext: undefined }))).toEqual([]);
  });

  it('does not fire when suppressed', () => {
    expect(() => assertRuntimeSafety(input({ ignoreUnsafeReasons: ['LCMS_OAUTH2_INSECURE_CONTEXT'] }), badProbe)).not
      .toThrow();
  });
});

describe('LCMS_OAUTH2_NODE_UNSUPPORTED', () => {
  const badProbe = probe({ nodeMajor: 18 });

  it('fires below the supported floor and the message names the code', () => {
    expect(syncCodes(input(), badProbe)).toContain('LCMS_OAUTH2_NODE_UNSUPPORTED');
    expect(() => assertRuntimeSafety(input(), badProbe)).toThrowError(/LCMS_OAUTH2_NODE_UNSUPPORTED/);
  });

  it('does not fire when not running on Node or at/above the floor', () => {
    expect(syncCodes(input(), probe({ nodeMajor: undefined }))).toEqual([]);
    expect(syncCodes(input(), probe({ nodeMajor: 24 }))).toEqual([]);
  });

  it('does not fire when suppressed', () => {
    expect(() => assertRuntimeSafety(input({ ignoreUnsafeReasons: ['LCMS_OAUTH2_NODE_UNSUPPORTED'] }), badProbe)).not
      .toThrow();
  });
});

describe('LCMS_OAUTH2_IGNORE_LIST_UNKNOWN_CODE', () => {
  it('fires for an unknown ignore entry and the message names the code', () => {
    const gateInput = input({ ignoreUnsafeReasons: ['LCMS_OAUTH2_NOT_A_REAL_CODE'] });
    expect(syncCodes(gateInput, probe())).toEqual(['LCMS_OAUTH2_IGNORE_LIST_UNKNOWN_CODE']);
    expect(() => assertRuntimeSafety(gateInput, probe())).toThrowError(/LCMS_OAUTH2_IGNORE_LIST_UNKNOWN_CODE/);
  });

  it('is validated FIRST: an untrusted ignore list preempts other findings', () => {
    const badProbe = probe({ hasGetRandomValues: false, randomSampleA: undefined, randomSampleB: undefined });
    const gateInput = input({ ignoreUnsafeReasons: ['typo'] });
    expect(syncCodes(gateInput, badProbe)).toEqual(['LCMS_OAUTH2_IGNORE_LIST_UNKNOWN_CODE']);
  });

  it('is not suppressible', () => {
    const gateInput = input({
      ignoreUnsafeReasons: ['LCMS_OAUTH2_IGNORE_LIST_UNKNOWN_CODE', 'LCMS_OAUTH2_NOT_A_REAL_CODE'],
    });
    expect(() => assertRuntimeSafety(gateInput, probe())).toThrowError(/LCMS_OAUTH2_IGNORE_LIST_UNKNOWN_CODE/);
  });

  it('also guards the async gate', async () => {
    const gateInput = input({ ignoreUnsafeReasons: ['LCMS_OAUTH2_NOT_A_REAL_CODE'] });
    await expect(assertRuntimeSafetyAsync(gateInput, probe())).rejects.toThrowError(
      /LCMS_OAUTH2_IGNORE_LIST_UNKNOWN_CODE/,
    );
  });
});

describe('LCMS_OAUTH2_SHA256_UNAVAILABLE', () => {
  it('fires when subtle.digest rejects and the message names the code', async () => {
    vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('unsupported'));
    const codes = await asyncCodes(input(), probe());
    expect(codes).toEqual(['LCMS_OAUTH2_SHA256_UNAVAILABLE']);
    await expect(assertRuntimeSafetyAsync(input(), probe())).rejects.toThrowError(/LCMS_OAUTH2_SHA256_UNAVAILABLE/);
  });

  it('fires when the probe reports crypto.subtle absent', async () => {
    const codes = await asyncCodes(input(), probe({ hasSubtle: false }));
    expect(codes).toContain('LCMS_OAUTH2_SHA256_UNAVAILABLE');
  });

  it('does not fire when suppressed', async () => {
    vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('unsupported'));
    await expect(
      assertRuntimeSafetyAsync(input({ ignoreUnsafeReasons: ['LCMS_OAUTH2_SHA256_UNAVAILABLE'] }), probe()),
    ).resolves.toBeUndefined();
  });
});

describe('LCMS_OAUTH2_HMAC_UNAVAILABLE', () => {
  it('fires when HMAC generateKey rejects and the message names the code', async () => {
    vi.spyOn(crypto.subtle, 'generateKey').mockRejectedValue(new Error('unsupported'));
    const codes = await asyncCodes(input(), probe());
    expect(codes).toEqual(['LCMS_OAUTH2_HMAC_UNAVAILABLE']);
    await expect(assertRuntimeSafetyAsync(input(), probe())).rejects.toThrowError(/LCMS_OAUTH2_HMAC_UNAVAILABLE/);
  });

  it('fires when HMAC sign rejects', async () => {
    vi.spyOn(crypto.subtle, 'sign').mockRejectedValue(new Error('unsupported'));
    const codes = await asyncCodes(input(), probe());
    expect(codes).toEqual(['LCMS_OAUTH2_HMAC_UNAVAILABLE']);
  });

  it('does not fire when suppressed', async () => {
    vi.spyOn(crypto.subtle, 'generateKey').mockRejectedValue(new Error('unsupported'));
    await expect(
      assertRuntimeSafetyAsync(input({ ignoreUnsafeReasons: ['LCMS_OAUTH2_HMAC_UNAVAILABLE'] }), probe()),
    ).resolves.toBeUndefined();
  });
});

describe('LCMS_OAUTH2_PASSKEY_ES256_UNAVAILABLE', () => {
  it('fires when ECDSA P-256 importKey rejects and passkeys are enabled', async () => {
    vi.spyOn(crypto.subtle, 'importKey').mockRejectedValue(new Error('unsupported'));
    const codes = await asyncCodes(input({ passkeyEnabled: true }), probe());
    expect(codes).toEqual(['LCMS_OAUTH2_PASSKEY_ES256_UNAVAILABLE']);
    await expect(assertRuntimeSafetyAsync(input({ passkeyEnabled: true }), probe())).rejects.toThrowError(
      /LCMS_OAUTH2_PASSKEY_ES256_UNAVAILABLE/,
    );
  });

  it('does not fire when passkeys are disabled, even if ECDSA is broken', async () => {
    vi.spyOn(crypto.subtle, 'importKey').mockRejectedValue(new Error('unsupported'));
    expect(await asyncCodes(input({ passkeyEnabled: false }), probe())).toEqual([]);
  });

  it('does not fire when suppressed', async () => {
    vi.spyOn(crypto.subtle, 'importKey').mockRejectedValue(new Error('unsupported'));
    await expect(
      assertRuntimeSafetyAsync(
        input({ passkeyEnabled: true, ignoreUnsafeReasons: ['LCMS_OAUTH2_PASSKEY_ES256_UNAVAILABLE'] }),
        probe(),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('post-quantum threat model', () => {
  it('LCMS_OAUTH2_PQ_PASSKEY_SIGNATURE fires when passkeys are enabled', () => {
    const gateInput = input({ threatModel: 'post-quantum', passkeyEnabled: true });
    const codes = syncCodes(gateInput, probe());
    expect(codes).toContain('LCMS_OAUTH2_PQ_PASSKEY_SIGNATURE');
    expect(codes).not.toContain('LCMS_OAUTH2_PQ_PASSWORD_ONLY');
    expect(() => assertRuntimeSafety(gateInput, probe())).toThrowError(/LCMS_OAUTH2_PQ_PASSKEY_SIGNATURE/);
  });

  it('LCMS_OAUTH2_PQ_PASSWORD_ONLY fires when neither TOTP nor passkeys are configured', () => {
    const gateInput = input({ threatModel: 'post-quantum' });
    const codes = syncCodes(gateInput, probe());
    expect(codes).toContain('LCMS_OAUTH2_PQ_PASSWORD_ONLY');
    expect(() => assertRuntimeSafety(gateInput, probe())).toThrowError(/LCMS_OAUTH2_PQ_PASSWORD_ONLY/);
  });

  it('LCMS_OAUTH2_PQ_TRANSPORT_UNVERIFIED always fires under this threat model', () => {
    expect(syncCodes(input({ threatModel: 'post-quantum', totpEnabled: true }), probe())).toEqual([
      'LCMS_OAUTH2_PQ_TRANSPORT_UNVERIFIED',
    ]);
    expect(() => assertRuntimeSafety(input({ threatModel: 'post-quantum', totpEnabled: true }), probe())).toThrowError(
      /LCMS_OAUTH2_PQ_TRANSPORT_UNVERIFIED/,
    );
  });

  it('none of the PQ codes fire under the standard threat model', () => {
    expect(syncCodes(input({ threatModel: 'standard', passkeyEnabled: true }), probe())).toEqual([]);
  });

  it('do not fire when suppressed', () => {
    const gateInput = input({
      threatModel: 'post-quantum',
      passkeyEnabled: true,
      ignoreUnsafeReasons: [
        'LCMS_OAUTH2_PQ_PASSKEY_SIGNATURE',
        'LCMS_OAUTH2_PQ_PASSWORD_ONLY',
        'LCMS_OAUTH2_PQ_TRANSPORT_UNVERIFIED',
      ],
    });
    expect(() => assertRuntimeSafety(gateInput, probe())).not.toThrow();
  });
});

describe('aggregation and message format', () => {
  it('throws ONE error carrying ALL remaining codes', () => {
    const badProbe = probe({
      hasGetRandomValues: false,
      hasSubtle: false,
      isSecureContext: false,
      nodeMajor: 16,
      randomSampleA: undefined,
      randomSampleB: undefined,
    });
    expect(syncCodes(input(), badProbe)).toEqual([
      'LCMS_OAUTH2_CSPRNG_MISSING',
      'LCMS_OAUTH2_WEBCRYPTO_SUBTLE_MISSING',
      'LCMS_OAUTH2_INSECURE_CONTEXT',
      'LCMS_OAUTH2_NODE_UNSUPPORTED',
    ]);
  });

  it('formats the refusal message exactly as specified', () => {
    let error: UnsafeRuntimeError | undefined;
    try {
      assertRuntimeSafety(input(), probe({ isSecureContext: false }));
    } catch (caught) {
      error = caught as UnsafeRuntimeError;
    }
    expect(error).toBeInstanceOf(UnsafeRuntimeError);
    const message = error!.message;
    expect(message.startsWith(
      '@laikacms/decap/decap-oauth2 refused to start: this environment cannot uphold guarantees the package makes.\n\n',
    )).toBe(true);
    const spec = UNSAFE_REASONS.LCMS_OAUTH2_INSECURE_CONTEXT;
    expect(message).toContain(`[LCMS_OAUTH2_INSECURE_CONTEXT] ${spec.title}`);
    expect(message).toContain(`  Risk:   ${spec.risk}`);
    expect(message).toContain(`  Remedy: ${spec.remedy}`);
    expect(message).toContain(
      "Override only if you accept the risk:\n  decapOauth2({ ..., ignoreUnsafeReasons: ['LCMS_OAUTH2_INSECURE_CONTEXT'] })",
    );
  });
});

describe('suppressedReasons', () => {
  it('reports construct codes that fire but were suppressed', () => {
    const gateInput = input({ ignoreUnsafeReasons: ['LCMS_OAUTH2_INSECURE_CONTEXT'] });
    expect(suppressedReasons(gateInput, probe({ isSecureContext: false }))).toEqual([
      'LCMS_OAUTH2_INSECURE_CONTEXT',
    ]);
    expect(suppressedReasons(gateInput, probe())).toEqual([]);
  });

  it('reports first-request codes that fire but were suppressed', async () => {
    vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('unsupported'));
    const gateInput = input({ ignoreUnsafeReasons: ['LCMS_OAUTH2_SHA256_UNAVAILABLE'] });
    await expect(suppressedReasonsAsync(gateInput, probe())).resolves.toEqual(['LCMS_OAUTH2_SHA256_UNAVAILABLE']);
  });
});

describe('HEALTHY-RUNTIME', () => {
  // A gate that misfires on a sound environment is an outage we shipped.
  it('fires ZERO codes against the real probe on this test runtime (sync and async)', async () => {
    const realProbe = captureRuntimeProbe();
    const gateInput = input({ passkeyEnabled: true, totpEnabled: true });

    expect(() => assertRuntimeSafety(gateInput, realProbe)).not.toThrow();
    await expect(assertRuntimeSafetyAsync(gateInput, realProbe)).resolves.toBeUndefined();

    // Also through the defaulted-probe path.
    expect(() => assertRuntimeSafety(gateInput)).not.toThrow();
    await expect(assertRuntimeSafetyAsync(gateInput)).resolves.toBeUndefined();

    expect(suppressedReasons(gateInput, realProbe)).toEqual([]);
    await expect(suppressedReasonsAsync(gateInput, realProbe)).resolves.toEqual([]);
  });

  it('captureRuntimeProbe reflects a sound environment', () => {
    const realProbe = captureRuntimeProbe();
    expect(realProbe.hasCrypto).toBe(true);
    expect(realProbe.hasGetRandomValues).toBe(true);
    expect(realProbe.hasSubtle).toBe(true);
    expect(realProbe.randomSampleA).toMatch(/^[0-9a-f]{64}$/);
    expect(realProbe.randomSampleB).toMatch(/^[0-9a-f]{64}$/);
    expect(realProbe.randomSampleA).not.toBe(realProbe.randomSampleB);
    expect(typeof realProbe.nodeMajor).toBe('number');
  });
});

describe('REGISTRY INTEGRITY', () => {
  const entries = Object.entries(UNSAFE_REASONS);

  it('every code matches the permanent naming scheme', () => {
    for (const [code] of entries) {
      expect(code).toMatch(/^LCMS_OAUTH2_[A-Z0-9_]+$/);
    }
  });

  it('every spec has non-empty title, risk and remedy, a valid phase and a detector', () => {
    for (const [, spec] of entries) {
      expect(spec.title.trim().length).toBeGreaterThan(0);
      expect(spec.risk.trim().length).toBeGreaterThan(0);
      expect(spec.remedy.trim().length).toBeGreaterThan(0);
      expect(['construct', 'first-request']).toContain(spec.when);
      expect(typeof spec.detect).toBe('function');
    }
  });

  it('exactly one code is non-ignorable', () => {
    const nonIgnorable = entries.filter(([, spec]) => !spec.ignorable).map(([code]) => code);
    expect(nonIgnorable).toEqual(['LCMS_OAUTH2_IGNORE_LIST_UNKNOWN_CODE']);
  });
});
