import * as Result from 'effect/Result';

import type { LaikaResult } from 'laikacms/core';
import {
  AuthenticationError,
  BadRequestError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError,
  VersionMismatchError,
} from 'laikacms/core';

const DEFAULT_API_URL = 'https://firestore.googleapis.com/v1';

/**
 * Path segments must match this — Firestore document IDs allow letters,
 * digits, hyphens, underscores, and periods. Forbidden characters like `/`
 * or `%` would either break the URL or violate Firestore's naming rules.
 */
export const SEGMENT_REGEX = /^[A-Za-z0-9._-]+$/;

/** Auth for the Firestore REST API. Bearer access tokens only. */
export interface FirestoreAuth {
  readonly accessToken?: string;
  readonly tokenProvider?: () => string | Promise<string>;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Configuration for a {@link FirestoreDataSource}. */
export interface FirestoreDataSourceOptions {
  readonly auth: FirestoreAuth;
  /** GCP project id. */
  readonly projectId: string;
  /** Firestore database id; defaults to `(default)`. */
  readonly databaseId?: string;
  /** Root collection name — every Laika key is scoped under this. Defaults to `laika`. */
  readonly rootCollection?: string;
  /** Subcollection name for nested items. Defaults to `items` (so the wire path is `<root>/<seg>/items/<seg>/...`). */
  readonly itemsCollection?: string;
  /** Override the API base URL. Defaults to `https://firestore.googleapis.com/v1`. */
  readonly apiUrl?: string;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

/** Firestore's typed-value wire shape. */
export type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string | number }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { nullValue: null }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

export type FirestoreFields = Record<string, FirestoreValue>;

/** A Firestore document as returned by the REST API. */
export interface FirestoreDocument {
  /** Full resource name: `projects/.../databases/.../documents/<path>`. */
  readonly name: string;
  readonly fields?: FirestoreFields;
  readonly createTime?: string;
  readonly updateTime?: string;
}

/** Convert a plain JS value to Firestore's typed-value wrapper. */
export const toFirestoreValue = (value: unknown): FirestoreValue => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === 'object') {
    const fields: Record<string, FirestoreValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) fields[k] = toFirestoreValue(v);
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
};

/** Unwrap a Firestore typed value back into a plain JS value. */
export const fromFirestoreValue = (value: FirestoreValue): unknown => {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(fromFirestoreValue);
  if ('mapValue' in value) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value.mapValue.fields ?? {})) out[k] = fromFirestoreValue(v);
    return out;
  }
  return undefined;
};

/** Bulk wrappers — convert a whole object's worth of fields in one shot. */
export const toFirestoreFields = (record: Record<string, unknown>): FirestoreFields => {
  const out: FirestoreFields = {};
  for (const [k, v] of Object.entries(record)) out[k] = toFirestoreValue(v);
  return out;
};

export const fromFirestoreFields = (fields: FirestoreFields): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = fromFirestoreValue(v);
  return out;
};

const safeText = async (response: Response): Promise<string> => {
  try { return await response.text(); } catch { return ''; }
};

const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed.error?.message) detail = `: ${parsed.error.message}`;
  } catch { /* not JSON */ }
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`Firestore authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`Firestore access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`Firestore document not found: ${context}`));
    case 409:
    case 412:
      return Result.fail(new VersionMismatchError(`Firestore precondition failed for ${context}${detail}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`Firestore rate-limited request for ${context}`));
    case 503:
      return Result.fail(new ServiceUnavailableError(`Firestore service unavailable for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`Firestore returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`Firestore returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Validate every segment of a `/`-separated path against {@link SEGMENT_REGEX}.
 * Surfaces immediately as a `BadRequestError` if anything would break the wire
 * path or violate Firestore's document-id rules.
 */
export const validateSegments = (key: string): LaikaResult<readonly string[]> => {
  const segments = key.replace(/^\/+|\/+$/g, '').split('/').filter(s => s !== '');
  for (const segment of segments) {
    if (!SEGMENT_REGEX.test(segment)) {
      return Result.fail(new BadRequestError(
        `Firestore storage keys may only contain letters, digits, hyphens, underscores, and periods; got "${segment}"`,
      ));
    }
    if (segment.startsWith('__') && segment.endsWith('__')) {
      return Result.fail(new BadRequestError(
        `Firestore reserves segments of the form "__*__"; got "${segment}"`,
      ));
    }
  }
  return Result.succeed(segments);
};

/**
 * Talks the [Firestore REST API](https://firebase.google.com/docs/firestore/reference/rest)
 * over `fetch`. Firestore models hierarchy as **alternating collection ⇄
 * document pairs** — this datasource walks Laika's `/`-separated keys onto
 * that structure: every path segment becomes a Firestore document, and
 * every folder owns an `items` subcollection containing its children.
 *
 * For storage key `a/b/c` under root collection `laika` (defaults), the wire
 * path is `laika/a/items/b/items/c`. Listing folder `a/b` is one native
 * `GET /laika/a/items/b/items` call — Firestore-native semantics rather
 * than a prefix scan.
 */
export class FirestoreDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: FirestoreAuth;
  private readonly apiUrl: string;
  private readonly projectId: string;
  private readonly databaseId: string;
  private readonly rootCollection: string;
  private readonly itemsCollection: string;

  constructor(options: FirestoreDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError('No `fetch` implementation available; pass one via FirestoreDataSourceOptions.fetch');
    }
    if (!options.auth.accessToken && !options.auth.tokenProvider) {
      throw new InternalError('FirestoreDataSource requires `auth.accessToken` or `auth.tokenProvider`');
    }
    this.auth = options.auth;
    this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
    this.projectId = options.projectId;
    this.databaseId = options.databaseId ?? '(default)';
    this.rootCollection = options.rootCollection ?? 'laika';
    this.itemsCollection = options.itemsCollection ?? 'items';
  }

  /** Items-collection name — exposed for the repository's wire-shape helpers. */
  get itemsName(): string {
    return this.itemsCollection;
  }

  /** Build the document path: `<root>/<seg>/items/<seg>/.../items/<seg>`. */
  documentPath(segments: readonly string[]): string {
    if (segments.length === 0) return this.rootCollection;
    const interleaved = [this.rootCollection, segments[0]];
    for (let i = 1; i < segments.length; i++) {
      interleaved.push(this.itemsCollection, segments[i]);
    }
    return interleaved.join('/');
  }

  /** Build the collection path for "the items under this folder". */
  collectionPath(segments: readonly string[]): string {
    if (segments.length === 0) return this.rootCollection;
    return `${this.documentPath(segments)}/${this.itemsCollection}`;
  }

  private fullResource(path: string): string {
    return `${this.apiUrl}/projects/${encodeURIComponent(this.projectId)}/databases/${encodeURIComponent(this.databaseId)}/documents/${path}`;
  }

  private async accessToken(): Promise<string> {
    if (this.auth.tokenProvider) return await this.auth.tokenProvider();
    return this.auth.accessToken as string;
  }

  private async request(method: string, url: string, body?: unknown): Promise<Response> {
    const token = await this.accessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(this.auth.headers ?? {}),
    };
    return this.fetchImpl(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  }

  /** GET a document. `null` on 404. */
  async getDocument(segments: readonly string[]): Promise<LaikaResult<FirestoreDocument | null>> {
    let response: Response;
    try {
      response = await this.request('GET', this.fullResource(this.documentPath(segments)));
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Firestore unreachable', { cause }));
    }
    if (response.status === 404) return Result.succeed(null);
    if (!response.ok) return errorForResponse(response.status, await safeText(response), segments.join('/'));
    return Result.succeed((await response.json()) as FirestoreDocument);
  }

  /** PATCH (create-or-update) a document. */
  async putDocument(
    segments: readonly string[],
    fields: FirestoreFields,
  ): Promise<LaikaResult<FirestoreDocument>> {
    let response: Response;
    try {
      // PATCH with no `updateMask` overwrites the whole document — the
      // behaviour we want for storage objects.
      response = await this.request('PATCH', this.fullResource(this.documentPath(segments)), { fields });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Firestore unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), segments.join('/'));
    return Result.succeed((await response.json()) as FirestoreDocument);
  }

  /** DELETE a document. 404 is treated as success. */
  async deleteDocument(segments: readonly string[]): Promise<LaikaResult<void>> {
    let response: Response;
    try {
      response = await this.request('DELETE', this.fullResource(this.documentPath(segments)));
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Firestore unreachable', { cause }));
    }
    if (response.ok || response.status === 404) return Result.succeed(undefined);
    return errorForResponse(response.status, await safeText(response), segments.join('/'));
  }

  /**
   * List a folder's items via the items-subcollection. Pages through
   * `nextPageToken` until exhausted. Returns an empty array for collections
   * with no documents (cannot distinguish "missing" from "empty" at the wire
   * level — that's the repository's job via a folder-marker check).
   */
  async listCollection(segments: readonly string[]): Promise<LaikaResult<FirestoreDocument[]>> {
    const out: FirestoreDocument[] = [];
    let pageToken: string | undefined;
    do {
      let response: Response;
      try {
        const url = new URL(this.fullResource(this.collectionPath(segments)));
        url.searchParams.set('pageSize', '300');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        response = await this.request('GET', url.toString());
      } catch (cause) {
        return Result.fail(new ServiceUnavailableError('Firestore unreachable', { cause }));
      }
      if (!response.ok) return errorForResponse(response.status, await safeText(response), segments.join('/') || '<root>');
      const data = (await response.json()) as { documents?: FirestoreDocument[]; nextPageToken?: string };
      if (data.documents) out.push(...data.documents);
      pageToken = data.nextPageToken;
    } while (pageToken);
    return Result.succeed(out);
  }
}
