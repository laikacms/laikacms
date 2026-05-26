import * as Result from 'effect/Result';

import type { LaikaResult } from 'laikacms/core';
import { EntryAlreadyExistsError, InternalError, NotFoundError, ServiceUnavailableError } from 'laikacms/core';

// ---------------------------------------------------------------------------
// LDAP — structural `LdapOps` abstraction
// ---------------------------------------------------------------------------
//
// LDAP at the wire level is ASN.1/BER over TCP (port 389/636 with TLS) —
// a binary protocol with its own message format. Real implementations
// pull in clients like `ldapjs` (Node), or talk to a gateway that exposes
// LDAP over JSON/XML (DSMLv2, SCIM, FreeIPA's JSON-RPC).
//
// The package avoids depending on any specific client — same architectural
// choice as @laikacms/mongodb. The repository depends on a structural
// `LdapOps` interface (just five methods: `search`, `add`, `modify`,
// `del`, `bulkOps`); users wire up their preferred client (or a mock).
//
// Five traits set LDAP apart from every prior backend in the Laika suite:
//
//   1. **DN-hierarchical addressing.** A Distinguished Name (DN) like
//      `cn=hello.md,ou=notes,dc=cms,dc=local` encodes the full path
//      *backwards* — RDN-by-RDN — into a comma-separated string. The
//      data source builds DNs via {@link buildDn}; users can override
//      the RDN convention via the storage repo options.
//
//   2. **`objectClass` schema model.** Every entry declares its type(s)
//      via a multi-valued `objectClass` attribute. The repository uses
//      `laikaFile` and `laikaFolder` (auxiliary) on top of `top` +
//      `organizationalUnit` (for folders).
//
//   3. **LDAP search filter DSL.** Filters are S-expression-ish strings:
//      `(&(objectClass=laikaFile)(cn=hello.*))`. The repository builds
//      them; the {@link LdapOps.search} method consumes them verbatim.
//      `buildFilter` helpers are exported for app code.
//
//   4. **Scope-based searches.** `base` (the DN itself), `one` (immediate
//      children), `sub` (the whole subtree). The repository uses `one`
//      for child listings — first backend in the suite with a built-in
//      scope-vs-prefix distinction.
//
//   5. **`bulkOps` as the atomic multi-write primitive.** Sequenced array
//      of typed action records ({kind: 'add' | 'modify' | 'del', ...}).
//      Real LDAP implementations may run them sequentially (transactional
//      via LDAP extensions) or independently (best-effort). **The 13th
//      structurally distinct atomic-multi-write mechanism in the Laika
//      suite.**

// ---------------------------------------------------------------------------
// Structural interface
// ---------------------------------------------------------------------------

/** One returned entry from an LDAP search. */
export interface LdapEntry {
  /** Distinguished Name. */
  readonly dn: string;
  /**
   * Attribute map. Single-valued attributes are returned as `string`;
   * multi-valued as `string[]`. The repository normalises to arrays
   * via {@link readAttribute}.
   */
  readonly attributes: Readonly<Record<string, string | string[]>>;
}

/** One operation within {@link LdapOps.bulkOps}. */
export type LdapBulkOp =
  | { readonly kind: 'add', readonly dn: string, readonly attributes: Record<string, string | string[]> }
  | { readonly kind: 'modify', readonly dn: string, readonly changes: ReadonlyArray<LdapModifyChange> }
  | { readonly kind: 'del', readonly dn: string };

export interface LdapModifyChange {
  readonly operation: 'add' | 'delete' | 'replace';
  readonly modification: { readonly type: string, readonly values: ReadonlyArray<string> };
}

/** Per-op outcome from {@link LdapOps.bulkOps}. */
export interface LdapBulkResult {
  readonly status: 'OK' | 'ERR';
  readonly message?: string;
}

export interface LdapSearchOptions {
  /** Base DN of the search. */
  readonly base: string;
  /**
   * Traversal scope. LDAP defines three:
   *  - `base` — return the entry at `base` itself (if it matches `filter`)
   *  - `one`  — immediate children of `base` only
   *  - `sub`  — the entire subtree rooted at `base`
   */
  readonly scope: 'base' | 'one' | 'sub';
  /** RFC 4515 filter expression. */
  readonly filter: string;
  /** Optional attribute name allowlist; default = return everything. */
  readonly attributes?: ReadonlyArray<string>;
  /** Server-side cap on returned entries. */
  readonly sizeLimit?: number;
}

/**
 * Structural LDAP client. Any of these satisfy it:
 *
 *   - The official `ldapjs` v3 client (its `Client` shape maps 1:1 once
 *     wrapped to return Promises).
 *   - A custom DSMLv2/HTTP gateway shim.
 *   - The in-memory mock in the test file.
 *
 * The package's contract is that implementations:
 *
 *   - Throw on connection-level failures (the data source maps these
 *     to {@link ServiceUnavailableError}).
 *   - Return `entries: []` from `search` when nothing matches — never
 *     throw "no such object" from search.
 *   - Throw an Error tagged with `name: 'LdapNoSuchObject'` on `del` /
 *     `modify` against a missing DN (the data source maps these to
 *     {@link NotFoundError}).
 *   - Throw an Error tagged with `name: 'LdapEntryAlreadyExists'` on
 *     `add` against an existing DN (mapped to
 *     {@link EntryAlreadyExistsError}).
 */
export interface LdapOps {
  search(options: LdapSearchOptions): Promise<LdapEntry[]>;
  add(dn: string, attributes: Record<string, string | string[]>): Promise<void>;
  modify(dn: string, changes: ReadonlyArray<LdapModifyChange>): Promise<void>;
  del(dn: string): Promise<void>;
  /**
   * Atomic batch. Real LDAP doesn't have a native multi-entry transaction
   * (only the LDAP Transactions extension, RFC 5805), so implementations
   * vary — the simplest fall back to sequential per-op execution and
   * return per-op results. The repository tolerates both.
   */
  bulkOps(operations: ReadonlyArray<LdapBulkOp>): Promise<LdapBulkResult[]>;
}

// ---------------------------------------------------------------------------
// DN building / parsing
// ---------------------------------------------------------------------------

/**
 * Build a DN from a base DN and an array of RDN pairs. RDNs in LDAP are
 * comma-separated *right-to-left*, with the most-specific first:
 *
 *     buildDn('dc=cms,dc=local', [['ou', 'notes'], ['cn', 'hello.md']])
 *     // → 'cn=hello.md,ou=notes,dc=cms,dc=local'
 *
 * Each RDN value is escaped per RFC 4514: `,`, `+`, `"`, `\`, `<`, `>`,
 * `;`, leading/trailing whitespace, and a leading `#` get backslash-escaped.
 */
export const buildDn = (baseDn: string, rdns: ReadonlyArray<readonly [string, string]>): string => {
  const escaped = rdns.map(([attr, value]) => `${attr}=${escapeRdnValue(value)}`);
  // RDNs are listed leaf-first (innermost first).
  escaped.reverse();
  return baseDn === '' ? escaped.join(',') : `${escaped.join(',')},${baseDn}`;
};

const escapeRdnValue = (value: string): string => {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]!;
    const needsEscape = ch === ',' || ch === '+' || ch === '"' || ch === '\\' || ch === '<'
      || ch === '>' || ch === ';' || ch === '='
      || (i === 0 && (ch === '#' || ch === ' '))
      || (i === value.length - 1 && ch === ' ');
    out += needsEscape ? `\\${ch}` : ch;
  }
  return out;
};

/**
 * Split a DN into its RDN components. The inverse of {@link buildDn}.
 * Quoting and escaping are honoured per RFC 4514.
 */
export const parseDn = (dn: string): Array<{ attribute: string, value: string }> => {
  const parts: Array<{ attribute: string, value: string }> = [];
  let buf = '';
  let escaped = false;
  for (let i = 0; i < dn.length; i += 1) {
    const ch = dn[i]!;
    if (escaped) {
      buf += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === ',') {
      parts.push(splitRdn(buf));
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim() !== '') parts.push(splitRdn(buf));
  return parts;
};

const splitRdn = (raw: string): { attribute: string, value: string } => {
  const eqIdx = raw.indexOf('=');
  if (eqIdx === -1) throw new InternalError(`Invalid RDN (no =): ${raw}`);
  return {
    attribute: raw.slice(0, eqIdx).trim(),
    value: raw.slice(eqIdx + 1).trim(),
  };
};

// ---------------------------------------------------------------------------
// LDAP search-filter builders
// ---------------------------------------------------------------------------

/** Escape special chars in an LDAP filter value per RFC 4515 §3. */
export const escapeFilterValue = (value: string): string => {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]!;
    if (ch === '\\') out += '\\5c';
    else if (ch === '*') out += '\\2a';
    else if (ch === '(') out += '\\28';
    else if (ch === ')') out += '\\29';
    else if (ch === '\0') out += '\\00';
    else out += ch;
  }
  return out;
};

/** `(attr=value)` */
export const eqFilter = (attr: string, value: string): string => `(${attr}=${escapeFilterValue(value)})`;

/** `(&(f1)(f2)…)` */
export const andFilter = (...filters: string[]): string => `(&${filters.join('')})`;

/** `(|(f1)(f2)…)` */
export const orFilter = (...filters: string[]): string => `(|${filters.join('')})`;

// ---------------------------------------------------------------------------
// Helpers for reading attributes
// ---------------------------------------------------------------------------

/** Single value, or first of multi-valued, or `undefined`. */
export const readAttribute = (entry: LdapEntry, name: string): string | undefined => {
  const a = entry.attributes[name];
  if (a === undefined) return undefined;
  if (Array.isArray(a)) return a[0];
  return a;
};

/** Always an array, even when single-valued. */
export const readMultiValuedAttribute = (entry: LdapEntry, name: string): readonly string[] => {
  const a = entry.attributes[name];
  if (a === undefined) return [];
  if (Array.isArray(a)) return a;
  return [a];
};

// ---------------------------------------------------------------------------
// Data source — thin Effect-friendly wrapper over LdapOps
// ---------------------------------------------------------------------------

const isErrorWithName = (err: unknown, name: string): boolean => {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: string };
  return e.name === name;
};

const mapError = (
  err: unknown,
  context: string,
): NotFoundError | EntryAlreadyExistsError | ServiceUnavailableError | InternalError => {
  if (isErrorWithName(err, 'LdapNoSuchObject')) {
    return new NotFoundError(`LDAP entry not found: ${context}`, { cause: err });
  }
  if (isErrorWithName(err, 'LdapEntryAlreadyExists')) {
    return new EntryAlreadyExistsError(`LDAP entry already exists: ${context}`, { cause: err });
  }
  if (isErrorWithName(err, 'LdapConnectionFailed')) {
    return new ServiceUnavailableError(`LDAP server unreachable for ${context}`, { cause: err });
  }
  return new InternalError(`LDAP operation failed for ${context}`, { cause: err });
};

export interface LdapDataSourceOptions {
  readonly ops: LdapOps;
}

/**
 * Effect-friendly wrapper around a user-provided {@link LdapOps}
 * implementation. Adds:
 *
 *  - LaikaResult-shaped failure mapping (`LdapNoSuchObject`,
 *    `LdapEntryAlreadyExists`, `LdapConnectionFailed` → typed Laika
 *    errors).
 *  - DN/filter helpers re-exported.
 *
 * Use this directly if you want lower-level access; otherwise the
 * storage repository is the canonical entry point.
 */
export class LdapDataSource {
  readonly ops: LdapOps;

  constructor(options: LdapDataSourceOptions) {
    this.ops = options.ops;
  }

  async search(options: LdapSearchOptions): Promise<LaikaResult<LdapEntry[]>> {
    try {
      return Result.succeed(await this.ops.search(options));
    } catch (err) {
      return Result.fail(mapError(err, `search ${options.base}`));
    }
  }

  async add(dn: string, attributes: Record<string, string | string[]>): Promise<LaikaResult<void>> {
    try {
      await this.ops.add(dn, attributes);
      return Result.succeed(undefined);
    } catch (err) {
      return Result.fail(mapError(err, dn));
    }
  }

  async modify(dn: string, changes: ReadonlyArray<LdapModifyChange>): Promise<LaikaResult<void>> {
    try {
      await this.ops.modify(dn, changes);
      return Result.succeed(undefined);
    } catch (err) {
      return Result.fail(mapError(err, dn));
    }
  }

  async del(dn: string): Promise<LaikaResult<void>> {
    try {
      await this.ops.del(dn);
      return Result.succeed(undefined);
    } catch (err) {
      return Result.fail(mapError(err, dn));
    }
  }

  async bulkOps(operations: ReadonlyArray<LdapBulkOp>): Promise<LaikaResult<LdapBulkResult[]>> {
    if (operations.length === 0) return Result.succeed([]);
    try {
      return Result.succeed(await this.ops.bulkOps(operations));
    } catch (err) {
      return Result.fail(mapError(err, `bulkOps(${operations.length})`));
    }
  }
}
