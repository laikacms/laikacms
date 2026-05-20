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

// ---------------------------------------------------------------------------
// Trello REST API data source
// ---------------------------------------------------------------------------
//
// Trello is a Kanban-style work-tracking product whose data model fits a
// CMS use case surprisingly well: boards contain ordered lists, lists
// contain ordered cards, and cards carry a `desc` field that holds
// Markdown content. Five traits set it apart from every prior backend
// in the Laika suite:
//
//   1. **Floating-point `pos` ordering.** Every card and list carries a
//      positive-float `pos` field — Trello uses this for drag-and-drop
//      ordering. The repository surfaces this in `metadata` (under the
//      same field name as the wire). **First backend with native
//      positional ordering at the wire level.**
//
//   2. **API key + token via URL query parameters.** Trello's
//      `?key=<apikey>&token=<token>` auth model is unique among the
//      suite — credentials travel in the URL query string, not the
//      `Authorization` header. The data source URL-encodes both
//      values on every request.
//
//   3. **Soft-delete via `closed=true`.** Lists are never physically
//      deleted via the REST API; they're "archived" by setting
//      `closed=true`. Cards CAN be physically deleted (DELETE
//      /1/cards/:id) — distinct lifecycle semantics across the two
//      resource types.
//
//   4. **2-level platform hierarchy maps to N-level Laika paths.** The
//      repository encodes deep paths into list names (e.g.,
//      `notes/sub/deep` is a list literally named `"notes/sub/deep"`)
//      and uses card names for file leaves. First backend that
//      flattens an arbitrary tree into a depth-limited platform.
//
//   5. **`dateLastActivity` as the change timestamp.** Trello sets
//      this server-side on every card mutation — first backend using
//      a server-managed change timestamp as the revision identifier.

const DEFAULT_API_URL = 'https://api.trello.com/1';

export interface TrelloAuth {
  /** Trello API key — provisioned at https://trello.com/app-key. */
  readonly apiKey: string;
  /** OAuth 1.0a-issued token — long-lived for app integrations. */
  readonly token: string;
}

export interface TrelloDataSourceOptions {
  readonly auth: TrelloAuth;
  /** Board id this data source operates against. */
  readonly boardId: string;
  /** Override the API base URL. Default `https://api.trello.com/1`. */
  readonly apiUrl?: string;
  /** Custom `fetch` — useful for tests and non-standard runtimes. */
  readonly fetch?: typeof fetch;
}

/** Subset of the Trello List object we read/write. */
export interface TrelloList {
  readonly id: string;
  readonly name: string;
  readonly closed: boolean;
  readonly pos: number;
  readonly idBoard: string;
}

/** Subset of the Trello Card object we read/write. */
export interface TrelloCard {
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  readonly closed: boolean;
  readonly pos: number;
  readonly idList: string;
  readonly idBoard: string;
  readonly dateLastActivity: string;
}

const safeText = async (response: Response): Promise<string> => {
  try { return await response.text(); } catch { return ''; }
};

const errorForResponse = <T>(status: number, body: string, context: string): LaikaResult<T> => {
  const detail = body ? `: ${body.slice(0, 200)}` : '';
  switch (status) {
    case 401:
      return Result.fail(new AuthenticationError(`Trello authentication failed for ${context}${detail}`));
    case 403:
      return Result.fail(new ForbiddenError(`Trello access denied for ${context}${detail}`));
    case 404:
      return Result.fail(new NotFoundError(`Trello not found: ${context}`));
    case 409:
      return Result.fail(new EntryAlreadyExistsError(`Trello conflict for ${context}${detail}`));
    case 429:
      return Result.fail(new TooManyRequestsError(`Trello rate-limited request for ${context}`));
    default:
      if (status >= 500) {
        return Result.fail(new ServiceUnavailableError(`Trello returned HTTP ${status} for ${context}`));
      }
      return Result.fail(new InternalError(`Trello returned HTTP ${status} for ${context}${detail}`));
  }
};

/**
 * Talks the Trello REST API over `fetch`. Six endpoints carry the work:
 *
 *  - `GET    /1/boards/{id}/lists`       — enumerate non-archived lists
 *  - `GET    /1/lists/{id}/cards`        — enumerate cards in a list
 *  - `POST   /1/lists`                   — create a list
 *  - `POST   /1/cards`                   — create a card
 *  - `PUT    /1/cards/{id}`              — update a card (desc, name, pos, …)
 *  - `PUT    /1/lists/{id}/closed`       — archive a list (soft delete)
 *  - `DELETE /1/cards/{id}`              — physically delete a card
 *
 * All requests carry the `?key=…&token=…` query parameters appended by
 * {@link request}. Form fields go in the body as
 * `application/x-www-form-urlencoded`.
 */
export class TrelloDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: TrelloAuth;
  private readonly apiUrl: string;
  readonly boardId: string;

  constructor(options: TrelloDataSourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new InternalError(
        'No `fetch` implementation available; pass one via TrelloDataSourceOptions.fetch',
      );
    }
    if (!options.auth?.apiKey || !options.auth?.token) {
      throw new InternalError('TrelloDataSource requires `auth.apiKey` and `auth.token`');
    }
    if (!options.boardId) throw new InternalError('TrelloDataSource requires `boardId`');
    this.auth = options.auth;
    this.boardId = options.boardId;
    this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
  }

  /**
   * Enumerate every (non-archived) list in the board. The `cards=none`
   * query param skips pulling card data — listing cards is a separate
   * call per list.
   */
  async listBoardLists(): Promise<LaikaResult<TrelloList[]>> {
    const url = `${this.apiUrl}/boards/${encodeURIComponent(this.boardId)}/lists?filter=open&cards=none`;
    let response: Response;
    try {
      response = await this.request('GET', url);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Trello unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), `lists in board ${this.boardId}`);
    return Result.succeed(await response.json() as TrelloList[]);
  }

  /** Enumerate cards in a list — only non-archived cards by default. */
  async listListCards(listId: string): Promise<LaikaResult<TrelloCard[]>> {
    const url = `${this.apiUrl}/lists/${encodeURIComponent(listId)}/cards?filter=open`;
    let response: Response;
    try {
      response = await this.request('GET', url);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Trello unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), `cards in list ${listId}`);
    return Result.succeed(await response.json() as TrelloCard[]);
  }

  /** Get a single card by id. `null` on 404. */
  async getCard(cardId: string): Promise<LaikaResult<TrelloCard | null>> {
    let response: Response;
    try {
      response = await this.request('GET', `${this.apiUrl}/cards/${encodeURIComponent(cardId)}`);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Trello unreachable', { cause }));
    }
    if (response.status === 404) return Result.succeed(null);
    if (!response.ok) return errorForResponse(response.status, await safeText(response), `card ${cardId}`);
    return Result.succeed(await response.json() as TrelloCard);
  }

  /** Create a list in the board. Returns the new list object. */
  async createList(name: string, options: { pos?: number | 'top' | 'bottom' } = {}): Promise<LaikaResult<TrelloList>> {
    const form = new URLSearchParams();
    form.set('name', name);
    form.set('idBoard', this.boardId);
    if (options.pos !== undefined) form.set('pos', String(options.pos));
    let response: Response;
    try {
      response = await this.request('POST', `${this.apiUrl}/lists`, { body: form, contentType: 'application/x-www-form-urlencoded' });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Trello unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), `create list ${name}`);
    return Result.succeed(await response.json() as TrelloList);
  }

  /** Create a card in a list. */
  async createCard(
    listId: string,
    name: string,
    options: { desc?: string; pos?: number | 'top' | 'bottom' } = {},
  ): Promise<LaikaResult<TrelloCard>> {
    const form = new URLSearchParams();
    form.set('idList', listId);
    form.set('name', name);
    if (options.desc !== undefined) form.set('desc', options.desc);
    if (options.pos !== undefined) form.set('pos', String(options.pos));
    let response: Response;
    try {
      response = await this.request('POST', `${this.apiUrl}/cards`, { body: form, contentType: 'application/x-www-form-urlencoded' });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Trello unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), `create card ${name}`);
    return Result.succeed(await response.json() as TrelloCard);
  }

  /** Update a card. Pass only the fields you want to change. */
  async updateCard(
    cardId: string,
    changes: { name?: string; desc?: string; pos?: number; closed?: boolean },
  ): Promise<LaikaResult<TrelloCard>> {
    const form = new URLSearchParams();
    if (changes.name !== undefined) form.set('name', changes.name);
    if (changes.desc !== undefined) form.set('desc', changes.desc);
    if (changes.pos !== undefined) form.set('pos', String(changes.pos));
    if (changes.closed !== undefined) form.set('closed', String(changes.closed));
    let response: Response;
    try {
      response = await this.request('PUT', `${this.apiUrl}/cards/${encodeURIComponent(cardId)}`, {
        body: form, contentType: 'application/x-www-form-urlencoded',
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Trello unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), `update card ${cardId}`);
    return Result.succeed(await response.json() as TrelloCard);
  }

  /** Archive a list — sets `closed=true`. There's no physical-delete endpoint. */
  async archiveList(listId: string): Promise<LaikaResult<void>> {
    const form = new URLSearchParams();
    form.set('value', 'true');
    let response: Response;
    try {
      response = await this.request('PUT', `${this.apiUrl}/lists/${encodeURIComponent(listId)}/closed`, {
        body: form, contentType: 'application/x-www-form-urlencoded',
      });
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Trello unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), `archive list ${listId}`);
    return Result.succeed(undefined);
  }

  /** Delete a card. Cards can be physically deleted (unlike lists). */
  async deleteCard(cardId: string): Promise<LaikaResult<void>> {
    let response: Response;
    try {
      response = await this.request('DELETE', `${this.apiUrl}/cards/${encodeURIComponent(cardId)}`);
    } catch (cause) {
      return Result.fail(new ServiceUnavailableError('Trello unreachable', { cause }));
    }
    if (!response.ok) return errorForResponse(response.status, await safeText(response), `delete card ${cardId}`);
    return Result.succeed(undefined);
  }

  // ───────────────────────── plumbing ─────────────────────────

  /**
   * Append `?key=…&token=…` to every URL. Trello's REST API authenticates
   * via query parameters, not headers — distinct from every other backend
   * in the suite.
   */
  private appendAuth(url: string): string {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}key=${encodeURIComponent(this.auth.apiKey)}&token=${encodeURIComponent(this.auth.token)}`;
  }

  private async request(
    method: string,
    url: string,
    init?: { body?: BodyInit; contentType?: string },
  ): Promise<Response> {
    return this.fetchImpl(this.appendAuth(url), {
      method,
      headers: {
        Accept: 'application/json',
        ...(init?.contentType ? { 'Content-Type': init.contentType } : {}),
      },
      body: init?.body,
    });
  }
}
