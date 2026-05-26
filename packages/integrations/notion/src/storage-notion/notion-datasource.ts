import * as Result from 'effect/Result';

import type { LaikaResult } from 'laikacms/core';
import {
  AuthenticationError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError,
} from 'laikacms/core';

/** Notion API version pin. Notion requires every request to carry this header. */
export const NOTION_API_VERSION = '2022-06-28';

const NOTION_API_URL = 'https://api.notion.com/v1';

/** Auth for the Notion API. */
export interface NotionAuth {
  /** Integration token (`secret_...`) or OAuth2 access token. */
  readonly accessToken?: string;
  /** Async token provider — called before every request so refreshes are transparent. */
  readonly tokenProvider?: () => string | Promise<string>;
  /** Extra headers merged into every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** Configuration for a {@link NotionDataSource}. */
export interface NotionDataSourceOptions {
  readonly auth: NotionAuth;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
  /** Override the API base URL (defaults to `https://api.notion.com/v1`). */
  readonly apiUrl?: string;
  /** Override the API-version header pin. Default: `2022-06-28`. */
  readonly notionVersion?: string;
}

/** Minimal Notion block shape — covers the fields the storage layer touches. */
export interface NotionBlock {
  readonly id: string;
  readonly type: string;
  readonly has_children?: boolean;
  readonly archived?: boolean;
  readonly child_page?: { readonly title: string };
  readonly paragraph?: { readonly rich_text: Array<{ readonly plain_text: string }> };
}

/**
 * Page-summary shape — what {@link NotionDataSource.findChildByTitle} and
 * {@link NotionDataSource.listChildPages} return. Wraps the parts of a
 * Notion page we care about for storage operations.
 */
export interface NotionPageSummary {
  readonly id: string;
  readonly title: string;
  readonly hasChildren: boolean;
  readonly archived: boolean;
  readonly createdTime?: string;
  readonly lastEditedTime?: string;
}

const safeText = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    return '';
  }
};

const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { message?: string };
    if (parsed.message) detail = `: ${parsed.message}`;
  } catch { /* not JSON */ }
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`Notion authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`Notion access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`Notion resource not found: ${context}`));
    case 409:
      return Result.fail(new ConflictError(`Notion conflict for ${context}${detail}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`Notion rate-limited request for ${context}`));
    case 503:
      return Result.fail(new ServiceUnavailableError(`Notion service unavailable for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`Notion returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`Notion returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Pull the displayed title out of a Notion page object. Notion's title is a
 * `title`-typed property whose name is conventionally `Name` or `title`, but
 * can be anything — so we scan properties for the first `title`-typed one.
 */
const titleOfPage = (page: { properties?: Record<string, unknown> }): string => {
  const props = page.properties ?? {};
  for (const value of Object.values(props)) {
    const v = value as { type?: string, title?: Array<{ plain_text: string }> };
    if (v.type === 'title' && Array.isArray(v.title)) {
      return v.title.map(rt => rt.plain_text).join('');
    }
  }
  return '';
};

/**
 * Talks the [Notion API](https://developers.notion.com) over `fetch`. Two
 * concerns this datasource handles for the repository:
 *
 * 1. **Pagination.** Notion's `start_cursor`/`next_cursor` cursor model is
 *    drained internally, so callers see a complete list per call.
 * 2. **Block-vs-page polymorphism.** Notion stores nested pages as a special
 *    `child_page` block in the parent's children. This data source returns
 *    them as `NotionPageSummary` objects so the repository can pretend pages
 *    and folders are first-class.
 */
export class NotionDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: NotionAuth;
  private readonly apiUrl: string;
  private readonly notionVersion: string;

  constructor(options: NotionDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError('No `fetch` implementation available; pass one via NotionDataSourceOptions.fetch');
    }
    if (!options.auth.accessToken && !options.auth.tokenProvider) {
      throw new InternalError('NotionDataSource requires `auth.accessToken` or `auth.tokenProvider`');
    }
    this.auth = options.auth;
    this.apiUrl = (options.apiUrl ?? NOTION_API_URL).replace(/\/+$/, '');
    this.notionVersion = options.notionVersion ?? NOTION_API_VERSION;
  }

  private async accessToken(): Promise<string> {
    if (this.auth.tokenProvider) return await this.auth.tokenProvider();
    return this.auth.accessToken as string;
  }

  private async request(
    method: string,
    path: string,
    init?: { body?: unknown, query?: Record<string, string> },
  ): Promise<Response> {
    const token = await this.accessToken();
    const url = new URL(`${this.apiUrl}${path}`);
    if (init?.query) { for (const [k, v] of Object.entries(init.query)) url.searchParams.set(k, v); }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Notion-Version': this.notionVersion,
      'Content-Type': 'application/json',
      ...(this.auth.headers ?? {}),
    };
    return this.fetchImpl(url.toString(), {
      method,
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  }

  /** GET a single page object. `null` on 404. */
  async getPage(pageId: string): Promise<LaikaResult<NotionPageSummary | null>> {
    let response: Response;
    try {
      response = await this.request('GET', `/pages/${encodeURIComponent(pageId)}`);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Notion unreachable', { cause }));
    }
    if (response.status === 404) return Result.succeed(null);
    if (!response.ok) return errorForResponse(response.status, await safeText(response), pageId);
    const page = (await response.json()) as {
      id: string,
      archived?: boolean,
      created_time?: string,
      last_edited_time?: string,
      properties?: Record<string, unknown>,
    };
    return Result.succeed({
      id: page.id,
      title: titleOfPage(page),
      // We don't actually know `hasChildren` from the page object alone — it's
      // exposed on blocks. The repository derives this from a separate
      // `listBlockChildren` call when it matters.
      hasChildren: false,
      archived: page.archived ?? false,
      createdTime: page.created_time,
      lastEditedTime: page.last_edited_time,
    });
  }

  /** List a page's children — both block content and child pages. Pages through `next_cursor`. */
  async listBlockChildren(pageId: string): Promise<LaikaResult<NotionBlock[]>> {
    const out: NotionBlock[] = [];
    let cursor: string | undefined;
    do {
      let response: Response;
      try {
        const query: Record<string, string> = { page_size: '100' };
        if (cursor) query.start_cursor = cursor;
        response = await this.request('GET', `/blocks/${encodeURIComponent(pageId)}/children`, { query });
      } catch (cause) {
        return Result.fail(new ServiceUnavailableError('Notion unreachable', { cause }));
      }
      if (response.status === 404) {
        return Result.fail(new NotFoundError(`Notion page not found: ${pageId}`));
      }
      if (!response.ok) return errorForResponse(response.status, await safeText(response), pageId);
      const data = (await response.json()) as { results: NotionBlock[], next_cursor?: string };
      out.push(...data.results);
      cursor = data.next_cursor ?? undefined;
    } while (cursor);
    return Result.succeed(out);
  }

  /**
   * List child *pages* of a page. Pages are stored as `child_page` blocks in
   * Notion's data model — this filters and projects them into a stable
   * page-summary shape so the repository doesn't need to think about blocks.
   */
  async listChildPages(parentPageId: string): Promise<LaikaResult<NotionPageSummary[]>> {
    const blocks = await this.listBlockChildren(parentPageId);
    if (Result.isFailure(blocks)) return Result.fail(blocks.failure);
    const summaries: NotionPageSummary[] = [];
    for (const block of blocks.success) {
      if (block.type !== 'child_page' || block.archived) continue;
      summaries.push({
        id: block.id,
        title: block.child_page?.title ?? '',
        hasChildren: block.has_children === true,
        archived: false,
      });
    }
    return Result.succeed(summaries);
  }

  /** Find a direct child page of `parentPageId` whose title matches exactly. */
  async findChildByTitle(
    parentPageId: string,
    title: string,
  ): Promise<LaikaResult<NotionPageSummary | null>> {
    const children = await this.listChildPages(parentPageId);
    if (Result.isFailure(children)) return Result.fail(children.failure);
    const hit = children.success.find(c => c.title === title);
    return Result.succeed(hit ?? null);
  }

  /**
   * Create a child page under `parentPageId` with the given title. Optionally
   * attach a single paragraph block carrying `body` as plain text — that's how
   * the repository persists object content.
   */
  async createChildPage(
    parentPageId: string,
    title: string,
    body?: string,
  ): Promise<LaikaResult<NotionPageSummary>> {
    const payload: Record<string, unknown> = {
      parent: { page_id: parentPageId },
      properties: {
        title: { title: [{ type: 'text', text: { content: title } }] },
      },
    };
    if (body !== undefined && body !== '') {
      payload.children = [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: body } }] },
        },
      ];
    }
    let response: Response;
    try {
      response = await this.request('POST', '/pages', { body: payload });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Notion unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), title);
    const created = (await response.json()) as {
      id: string,
      created_time?: string,
      last_edited_time?: string,
    };
    return Result.succeed({
      id: created.id,
      title,
      hasChildren: body !== undefined && body !== '',
      archived: false,
      createdTime: created.created_time,
      lastEditedTime: created.last_edited_time,
    });
  }

  /**
   * Replace a page's body. Notion doesn't expose a "replace blocks" call, so
   * we delete every existing block child via `archived: true` and append a
   * fresh paragraph. Not the most efficient — but it's atomic enough for
   * single-paragraph storage objects.
   */
  async replacePageBody(pageId: string, body: string): Promise<LaikaResult<void>> {
    const blocks = await this.listBlockChildren(pageId);
    if (Result.isFailure(blocks)) return Result.fail(blocks.failure);
    for (const block of blocks.success) {
      if (block.type === 'child_page') continue; // never delete nested pages
      const deleted = await this.archiveBlock(block.id);
      if (Result.isFailure(deleted)) return Result.fail(deleted.failure);
    }
    return this.appendParagraph(pageId, body);
  }

  /** Append a single paragraph block to a page. */
  async appendParagraph(pageId: string, body: string): Promise<LaikaResult<void>> {
    let response: Response;
    try {
      response = await this.request('PATCH', `/blocks/${encodeURIComponent(pageId)}/children`, {
        body: {
          children: [
            {
              object: 'block',
              type: 'paragraph',
              paragraph: { rich_text: [{ type: 'text', text: { content: body } }] },
            },
          ],
        },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Notion unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), pageId);
    return Result.succeed(undefined);
  }

  /** Archive (Notion's soft-delete) a block. */
  async archiveBlock(blockId: string): Promise<LaikaResult<void>> {
    let response: Response;
    try {
      response = await this.request('DELETE', `/blocks/${encodeURIComponent(blockId)}`);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Notion unreachable', { cause }));
    }
    if (response.status === 404) return Result.succeed(undefined);
    if (!response.ok) return errorForResponse(response.status, await safeText(response), blockId);
    return Result.succeed(undefined);
  }

  /** Archive a page (Notion treats pages as blocks for soft-delete). */
  async archivePage(pageId: string): Promise<LaikaResult<void>> {
    let response: Response;
    try {
      response = await this.request('PATCH', `/pages/${encodeURIComponent(pageId)}`, {
        body: { archived: true },
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Notion unreachable', { cause }));
    }
    if (response.status === 404) return Result.succeed(undefined);
    if (!response.ok) return errorForResponse(response.status, await safeText(response), pageId);
    return Result.succeed(undefined);
  }
}
