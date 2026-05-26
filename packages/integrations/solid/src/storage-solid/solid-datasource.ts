import * as Result from 'effect/Result';

import type { LaikaResult } from 'laikacms/core';
import {
  AuthenticationError,
  EntryAlreadyExistsError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError,
} from 'laikacms/core';

import { parseTurtle, resolveIri, type TurtleTriple } from './turtle.js';

// ---------------------------------------------------------------------------
// Solid Pod / LDP HTTP data source
// ---------------------------------------------------------------------------
//
// Solid (Social Linked Data) is a decentralised web specification — every
// user has a personal data store (a "Pod") with resources at HTTPS URIs,
// hierarchical containers, and RDF metadata. Five traits set it apart from
// every prior backend in the Laika suite:
//
//   1. **URI-as-identity.** Every resource IS its URL. No opaque object
//      ids, no `(table, id)` tuples, no nested document paths separate
//      from the wire address.
//
//   2. **Trailing-slash addressing.** `<pod>/notes/` is a container
//      (folder); `<pod>/notes.md` is a resource (file). The URL itself
//      disambiguates — first backend in the suite to use this convention.
//
//   3. **RDF/Turtle wire format for container listings.** `GET <container/>`
//      with `Accept: text/turtle` returns a Turtle document whose
//      `ldp:contains` triples enumerate the children. The data source
//      parses these via the focused Turtle parser in `./turtle.ts`.
//      First triple-store backend in the suite.
//
//   4. **Content negotiation.** Different resources speak different
//      formats — file content is `text/markdown` or `application/json`,
//      container metadata is `text/turtle`, ACLs are `text/turtle` at
//      a sibling `.acl` URI. The `Accept` header selects.
//
//   5. **LDP container semantics on POST/PUT.** `POST <container/>`
//      with a `Slug:` header creates a child at a server-derived URL;
//      `PUT <absolute-url>` creates or replaces at that exact URL. The
//      data source uses PUT exclusively for deterministic keys.

const LDP_BASIC_CONTAINER = 'http://www.w3.org/ns/ldp#BasicContainer';
const LDP_CONTAINER = 'http://www.w3.org/ns/ldp#Container';
const LDP_RESOURCE = 'http://www.w3.org/ns/ldp#Resource';
const LDP_CONTAINS = 'http://www.w3.org/ns/ldp#contains';

export interface SolidAuth {
  /** Bearer token. For Solid-OIDC, this is the DPoP-bound access token. */
  readonly accessToken?: string;
  /** Async hook — overrides `accessToken` when present. */
  readonly tokenProvider?: () => string | Promise<string>;
  /**
   * Extra headers merged onto every request. Useful for `DPoP:` proof
   * headers when using Solid-OIDC, since DPoP proofs are per-request.
   */
  readonly headers?: Readonly<Record<string, string>>;
}

export interface SolidDataSourceOptions {
  /**
   * Pod root URL — e.g. `https://alice.solidcommunity.net/laika/`. **MUST
   * end in `/`** to be treated as a container.
   */
  readonly podRoot: string;
  readonly auth?: SolidAuth;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

/** Returned by {@link SolidDataSource.getResource} on success. */
export interface SolidResource {
  readonly url: string;
  readonly content: string;
  readonly contentType: string;
  /** Pre-parsed `Last-Modified` header, if present. */
  readonly lastModified?: string;
  /** ETag — opaque per RFC 7232; included when the server emits one. */
  readonly etag?: string;
}

/** One child entry parsed from a container's Turtle listing. */
export interface SolidContainerChild {
  readonly url: string;
  readonly isContainer: boolean;
}

const safeText = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    return '';
  }
};

const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  const detail = body ? `: ${body.slice(0, 200)}` : '';
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`Solid Pod authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`Solid Pod access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`Solid Pod not found: ${context}`));
    case 409:
      return Result.fail(new EntryAlreadyExistsError(`Solid Pod conflict for ${context}${detail}`));
    case 412:
      // Precondition Failed — typically when If-Match / If-None-Match fails.
      return Result.fail(new EntryAlreadyExistsError(`Solid Pod precondition failed for ${context}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`Solid Pod rate-limited request for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`Solid Pod returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`Solid Pod returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Talks the Solid Pod / LDP HTTP API over `fetch`. Six methods carry
 * the work:
 *
 *  - `getResource(url)`    — `GET <url>` (Accept negotiated)
 *  - `putResource(url, …)` — `PUT <url>` with body + Content-Type; the
 *                            `If-None-Match: *` header makes it
 *                            create-only.
 *  - `deleteResource(url)` — `DELETE <url>`
 *  - `head(url)`           — `HEAD <url>` (existence probe, no body)
 *  - `listContainer(url)`  — `GET <url>` with `Accept: text/turtle`,
 *                            then parse `ldp:contains` triples
 *  - `createContainer(url)`— `PUT <url>` with
 *                            `Content-Type: text/turtle` and an empty
 *                            `<>` body that the server interprets as
 *                            `ldp:BasicContainer`
 */
export class SolidDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: SolidAuth;
  readonly podRoot: string;

  constructor(options: SolidDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError(
        'No `fetch` implementation available; pass one via SolidDataSourceOptions.fetch',
      );
    }
    if (!options.podRoot) throw new InternalError('SolidDataSource requires `podRoot`');
    if (!options.podRoot.endsWith('/')) {
      throw new InternalError('SolidDataSource `podRoot` must end with `/`');
    }
    this.auth = options.auth ?? {};
    this.podRoot = options.podRoot;
  }

  /** GET a resource. Returns `null` on 404. */
  async getResource(url: string, accept: string = '*/*'): Promise<LaikaResult<SolidResource | null>> {
    let response: Response;
    try {
      response = await this.request('GET', url, { headers: { Accept: accept } });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Solid Pod unreachable', { cause }));
    }
    if (response.status === 404) return Result.succeed(null);
    if (!response.ok) return errorForResponse(response.status, await safeText(response), url);
    return Result.succeed({
      url,
      content: await response.text(),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      lastModified: response.headers.get('last-modified') ?? undefined,
      etag: response.headers.get('etag') ?? undefined,
    });
  }

  /** HEAD a resource. Returns `true` if the resource exists. */
  async head(url: string): Promise<LaikaResult<boolean>> {
    let response: Response;
    try {
      response = await this.request('HEAD', url);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Solid Pod unreachable', { cause }));
    }
    if (response.status === 404) return Result.succeed(false);
    if (!response.ok) return errorForResponse(response.status, '', url);
    return Result.succeed(true);
  }

  /**
   * PUT a resource. Pass `createOnly: true` to set `If-None-Match: *`
   * (the LDP / HTTP convention for create-only PUT).
   */
  async putResource(
    url: string,
    content: string,
    options: { contentType?: string, createOnly?: boolean } = {},
  ): Promise<LaikaResult<void>> {
    const headers: Record<string, string> = {
      'Content-Type': options.contentType ?? 'application/octet-stream',
    };
    if (options.createOnly) headers['If-None-Match'] = '*';

    let response: Response;
    try {
      response = await this.request('PUT', url, { body: content, headers });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Solid Pod unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), url);
    return Result.succeed(undefined);
  }

  /** DELETE a resource. */
  async deleteResource(url: string): Promise<LaikaResult<void>> {
    let response: Response;
    try {
      response = await this.request('DELETE', url);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Solid Pod unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), url);
    return Result.succeed(undefined);
  }

  /**
   * Create a basic container. PUT to the container URL (which MUST end in
   * `/`) with `Content-Type: text/turtle` and an empty body. The LDP
   * convention is that the server treats this as a container declaration.
   */
  async createContainer(url: string): Promise<LaikaResult<void>> {
    if (!url.endsWith('/')) {
      return Result.fail(new InternalError(`Container URL must end with '/': ${url}`));
    }
    // Body declares `<>` (this URL) as an LDP container. Most Solid
    // implementations also accept an empty body + the right Link header,
    // but this form is the most portable.
    const body = `@prefix ldp: <http://www.w3.org/ns/ldp#>.
<> a ldp:BasicContainer, ldp:Container.`;
    const linkHeader = `<${LDP_BASIC_CONTAINER}>; rel="type"`;
    let response: Response;
    try {
      response = await this.request('PUT', url, {
        body,
        headers: { 'Content-Type': 'text/turtle', Link: linkHeader },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Solid Pod unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), url);
    return Result.succeed(undefined);
  }

  /**
   * List a container's children. GET `<container/>` with `Accept:
   * text/turtle`, then parse the `ldp:contains` triples. The Link headers
   * also identify the resource as a container — when both are present,
   * the Turtle body is authoritative.
   */
  async listContainer(url: string): Promise<LaikaResult<SolidContainerChild[]>> {
    if (!url.endsWith('/')) {
      return Result.fail(new InternalError(`Container URL must end with '/': ${url}`));
    }
    const result = await this.getResource(url, 'text/turtle');
    if (Result.isFailure(result)) return Result.fail(result.failure);
    if (result.success === null) {
      return Result.fail(new NotFoundError(`Container not found: ${url}`));
    }
    let triples: TurtleTriple[];
    try {
      triples = parseTurtle(result.success.content, url);
    } catch (cause) {
      return Result.fail(
        new InternalError(
          `Failed to parse Turtle from ${url}: ${(cause as Error).message}`,
          { cause },
        ),
      );
    }
    // Two pieces of info per child:
    //   1. The `ldp:contains` triples — gives us the URL of every child.
    //   2. The `rdf:type` triples for each child — tells us file vs container.
    const childUrls = new Set<string>();
    const containerUrls = new Set<string>();
    for (const t of triples) {
      if (t.predicate === LDP_CONTAINS) childUrls.add(t.object);
      // Reuse the type triples that Solid servers conventionally emit for
      // each contained resource — saves a HEAD per child.
      if (
        t.predicate === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
        && (t.object === LDP_BASIC_CONTAINER || t.object === LDP_CONTAINER)
      ) {
        containerUrls.add(t.subject);
      }
    }
    return Result.succeed([...childUrls].map(childUrl => {
      // Fall back to the URL trailing-slash convention when the type
      // wasn't asserted explicitly.
      const isContainer = containerUrls.has(childUrl) || childUrl.endsWith('/');
      return { url: childUrl, isContainer };
    }));
  }

  // ───────────────────────── plumbing ─────────────────────────

  resolveUrl(relative: string): string {
    return resolveIri(this.podRoot, relative);
  }

  private async accessToken(): Promise<string | null> {
    if (this.auth.tokenProvider) return await this.auth.tokenProvider();
    return this.auth.accessToken ?? null;
  }

  private async request(
    method: string,
    url: string,
    init?: { body?: BodyInit, headers?: Record<string, string> },
  ): Promise<Response> {
    const token = await this.accessToken();
    return this.fetchImpl(url, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(this.auth.headers ?? {}),
        ...(init?.headers ?? {}),
      },
      body: init?.body,
    });
  }
}
