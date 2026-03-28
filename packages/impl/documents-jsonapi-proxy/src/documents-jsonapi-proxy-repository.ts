import {
  IllegalStateException,
  InternalError,
  InvalidData,
  LaikaResult,
  LaikaError,
} from "@laikacms/core";
import * as Result from "effect/Result";
import {
  DocumentsRepository,
  type Document,
  type DocumentCreate,
  type DocumentUpdate,
  type ListRecordsOptions,
  type ListRevisionsOptions,
  type Record,
  type RecordSummary,
  type Revision,
  type RevisionCreate,
  type RevisionSummary,
  type Unpublished,
  type UnpublishedCreate,
  type UnpublishedUpdate,
} from "@laikacms/documents";
import {
  documentCreateToJsonApi,
  documentUpdateToJsonApi,
  documentFromJsonApi,
  documentSummaryFromJsonApi,
  revisionCreateToJsonApi,
  revisionFromJsonApi,
  revisionSummaryFromJsonApi,
  unpublishedCreateToJsonApi,
  unpublishedFromJsonApi,
  unpublishedSummaryFromJsonApi,
  unpublishedUpdateToJsonApi,
  type JsonApiCollectionResponse,
  type DocumentJsonApi,
  type DocumentSummaryJsonApi,
  type UnpublishedJsonApi,
  type UnpublishedSummaryJsonApi,
  type RevisionJsonApi,
  type RevisionSummaryJsonApi,
} from "@laikacms/documents-api";
import { paginationCodec } from "./pagination-codec.js";
import { errorFromResponse } from "@laikacms/json-api";

function failAs<T>(error: LaikaError): LaikaResult<T> {
  return Result.fail(error);
}

export interface DocumentsJsonApiProxyRepositoryOptions {
  baseUrl: string;
  authToken?: string;
  /** Dynamic token provider - called before each request */
  tokenPromise?: () => Promise<string>;
}

/**
 * JSON:API Proxy implementation of DocumentsRepository
 *
 * This implementation proxies all document operations through a JSON:API
 * endpoint, enabling microservice architecture by communicating with
 * packages/apis/documents-api over HTTP.
 */
export class DocumentsJsonApiProxyRepository extends DocumentsRepository {
  private readonly baseUrl: string;
  private readonly staticHeaders: HeadersInit;
  private readonly tokenPromise?: () => Promise<string>;

  constructor(options: DocumentsJsonApiProxyRepositoryOptions) {
    super();
    this.baseUrl = options.baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.tokenPromise = options.tokenPromise;
    this.staticHeaders = {
      "Content-Type": "application/vnd.api+json",
      Accept: "application/vnd.api+json",
      ...(options.authToken
        ? { Authorization: `Bearer ${options.authToken}` }
        : {}),
    };
  }

  /**
   * Get headers with dynamic token if tokenPromise is provided
   */
  private async getHeaders(): Promise<HeadersInit> {
    if (this.tokenPromise) {
      const token = await this.tokenPromise();
      return {
        ...this.staticHeaders,
        Authorization: `Bearer ${token}`,
      };
    }
    return this.staticHeaders;
  }

  private async handleResponse<T>(response: Response): Promise<LaikaResult<T>> {
    const contentType = response.headers.get("content-type");

    if (
      !contentType?.includes("application/vnd.api+json") &&
      !contentType?.includes("application/json")
    ) {
      return Result.fail(new InvalidData(`Expected JSON:API response, got ${contentType}`));
    }

    const json = await response.json();

    if (!response.ok) {
      const errorResult = await errorFromResponse(response);
      return Result.fail(new InvalidData(errorResult.message));
    }

    if ("errors" in json && Array.isArray(json.errors)) {
      return Result.fail(new InvalidData(
        json.errors.map((e: { detail?: string; title?: string }) => e.detail || e.title || "Unknown error").join(", "),
      ));
    }

    return Result.succeed(json.data as T);
  }

  private async handleVoidResponse(response: Response): Promise<LaikaResult<void>> {
    const contentType = response.headers.get("content-type");

    if (
      !contentType?.includes("application/vnd.api+json") &&
      !contentType?.includes("application/json")
    ) {
      return Result.fail(new InvalidData(`Expected JSON:API response, got ${contentType}`));
    }

    const json = await response.json();

    if (!response.ok) {
      const errors =
        "errors" in json && Array.isArray(json.errors)
          ? json.errors
          : [{ detail: "Unknown error" }];
      return Result.fail(new InvalidData(
        errors.map((e: { detail?: string; title?: string }) => e.detail || e.title || "Unknown error").join(", "),
      ));
    }

    if ("errors" in json && Array.isArray(json.errors)) {
      return Result.fail(new InvalidData(
        json.errors.map((e: { detail?: string; title?: string }) => e.detail || e.title || "Unknown error").join(", "),
      ));
    }

    return Result.succeed(undefined);
  }

  // ===== RECORDS =====

  /**
   * List full record objects with content
   */
  listRecords(
    options: ListRecordsOptions,
  ): AsyncGenerator<LaikaResult<readonly Record[]>> {
    return this.listFullRecords(options);
  }

  /**
   * List record summaries (without content) for efficient listing
   */
  listRecordSummaries(
    options: ListRecordsOptions,
  ): AsyncGenerator<LaikaResult<readonly RecordSummary[]>> {
    return this.listRecordSummariesInternal(options);
  }

  private async *listFullRecords(
    options: ListRecordsOptions,
  ): AsyncGenerator<LaikaResult<readonly Record[]>> {
    try {
      const params = paginationCodec.encode(options.pagination);
      if (options.type) {
        params.set("filter[type]", options.type);
      }
      params.set('filter[depth]', '' + options.depth)
      params.set("filter[folder]", options.folder);

      const headers = await this.getHeaders();
      const response = await fetch(`${this.baseUrl}/records?${params}`, {
        method: "GET",
        headers,
      });

      const contentType = response.headers.get("content-type");
      if (
        !contentType?.includes("application/vnd.api+json") &&
        !contentType?.includes("application/json")
      ) {
        yield Result.fail(new InvalidData(`Expected JSON:API response, got ${contentType}`));
        return;
      }

      const json: JsonApiCollectionResponse = await response.json();

      if (!response.ok || ("errors" in json && Array.isArray(json.errors))) {
        const errors =
          "errors" in json && Array.isArray(json.errors)
            ? json.errors
            : [{ detail: "Unknown error" }];
        yield Result.fail(new InvalidData(
          errors.map((e: { detail?: string; title?: string }) => e.detail || e.title || "Unknown error").join(", "),
        ));
        return;
      }

      // Parse each item based on its type
      const items: Record[] = [];
      for (const item of json.data) {
        try {
          let record: Record;
          switch (item.type) {
            case "published":
              record = documentFromJsonApi(item as DocumentJsonApi) as Record;
              break;
            case "unpublished":
              record = unpublishedFromJsonApi(item as UnpublishedJsonApi) as Record;
              break;
            case "revision":
              record = revisionFromJsonApi(item as RevisionJsonApi) as unknown as Record;
              break;
            case "folder":
              continue;
            default:
              throw new IllegalStateException("Unknown record type: " + item.type);
          }
          items.push(record);
        } catch (error) {
          yield Result.fail(new InvalidData((error as Error).message));
          return;
        }
      }

      yield Result.succeed(items);
    } catch (error) {
      yield Result.fail(new InternalError((error as Error).message));
    }
  }

  private async *listRecordSummariesInternal(
    options: ListRecordsOptions,
  ): AsyncGenerator<LaikaResult<readonly RecordSummary[]>> {
    try {
      const params = paginationCodec.encode(options.pagination);
      if (options.type) {
        params.set("filter[type]", options.type);
      }
      params.set('filter[depth]', '' + options.depth)
      params.set("filter[folder]", options.folder);

      const headers = await this.getHeaders();
      const response = await fetch(`${this.baseUrl}/record-summaries?${params}`, {
        method: "GET",
        headers,
      });

      const contentType = response.headers.get("content-type");
      if (
        !contentType?.includes("application/vnd.api+json") &&
        !contentType?.includes("application/json")
      ) {
        yield Result.fail(new InvalidData(`Expected JSON:API response, got ${contentType}`));
        return;
      }

      const json: JsonApiCollectionResponse = await response.json();

      if (!response.ok || ("errors" in json && Array.isArray(json.errors))) {
        const errors =
          "errors" in json && Array.isArray(json.errors)
            ? json.errors
            : [{ detail: "Unknown error" }];
        yield Result.fail(new InvalidData(
          errors.map((e: { detail?: string; title?: string }) => e.detail || e.title || "Unknown error").join(", "),
        ));
        return;
      }

      // Parse each item based on its type
      const items: RecordSummary[] = [];
      for (const item of json.data) {
        try {
          let summary: RecordSummary;
          switch (item.type) {
            case "published":
            case "published-summary":
              summary = documentSummaryFromJsonApi(item as DocumentSummaryJsonApi) as RecordSummary;
              break;
            case "unpublished":
            case "unpublished-summary":
              summary = unpublishedSummaryFromJsonApi(item as UnpublishedSummaryJsonApi) as RecordSummary;
              break;
            case "revision":
            case "revision-summary":
              summary = revisionSummaryFromJsonApi(item as RevisionSummaryJsonApi) as unknown as RecordSummary;
              break;
            case "folder":
              continue;
            default:
              throw new IllegalStateException("Unknown record type: " + item.type);
          }
          items.push(summary);
        } catch (error) {
          yield Result.fail(new InvalidData((error as Error).message));
          return;
        }
      }

      yield Result.succeed(items);
    } catch (error) {
      yield Result.fail(new InternalError((error as Error).message));
    }
  }

  // ===== DOCUMENTS (PUBLISHED) =====
  async *getDocument(key: string): AsyncGenerator<LaikaResult<Document>> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(
        `${this.baseUrl}/published/${encodeURIComponent(key)}`,
        { method: "GET", headers },
      );

      const result = await this.handleResponse<DocumentJsonApi>(response);
      if (Result.isFailure(result)) {
        yield failAs<Document>(result.failure);
        return;
      }

      try {
        const document = documentFromJsonApi(result.success);
        yield Result.succeed(document);
      } catch (error) {
        yield Result.fail(new InvalidData((error as Error).message));
      }
    } catch (error) {
      yield Result.fail(new InternalError((error as Error).message));
    }
  }

  async *createDocument(create: DocumentCreate): AsyncGenerator<LaikaResult<Document>> {
    try {
      const jsonApiData = documentCreateToJsonApi(create);
      console.log("Creating document with JSON:API data:", jsonApiData);
      const headers = await this.getHeaders();

      const response = await fetch(`${this.baseUrl}/published`, {
        method: "POST",
        headers,
        body: JSON.stringify({ data: jsonApiData }),
      });

      const result = await this.handleResponse<DocumentJsonApi>(response);
      if (Result.isFailure(result)) {
        yield failAs<Document>(result.failure);
        return;
      }

      try {
        const document = documentFromJsonApi(result.success);
        yield Result.succeed(document);
      } catch (error) {
        yield Result.fail(new InvalidData((error as Error).message));
      }
    } catch (error) {
      yield Result.fail(new InternalError((error as Error).message));
    }
  }

  async *updateDocument(update: DocumentUpdate): AsyncGenerator<LaikaResult<Document>> {
    try {
      const jsonApiData = documentUpdateToJsonApi(update);
      const headers = await this.getHeaders();

      const response = await fetch(
        `${this.baseUrl}/published/${encodeURIComponent(update.key)}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ data: jsonApiData }),
        },
      );

      const result = await this.handleResponse<DocumentJsonApi>(response);
      if (Result.isFailure(result)) {
        yield failAs<Document>(result.failure);
        return;
      }

      try {
        const document = documentFromJsonApi(result.success);
        yield Result.succeed(document);
      } catch (error) {
        yield Result.fail(new InvalidData((error as Error).message));
      }
    } catch (error) {
      yield Result.fail(new InternalError((error as Error).message));
    }
  }

  async *deleteDocument(key: string): AsyncGenerator<LaikaResult<void>> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(
        `${this.baseUrl}/published/${encodeURIComponent(key)}`,
        { method: "DELETE", headers },
      );

      yield await this.handleVoidResponse(response);
    } catch (error) {
      yield Result.fail(new InternalError((error as Error).message));
    }
  }

  // ===== UNPUBLISHED =====
  async *getUnpublished(key: string): AsyncGenerator<LaikaResult<Unpublished>> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(
        `${this.baseUrl}/unpublished/${encodeURIComponent(key)}`,
        { method: "GET", headers },
      );

      const result = await this.handleResponse<UnpublishedJsonApi>(response);
      if (Result.isFailure(result)) {
        yield failAs<Unpublished>(result.failure);
        return;
      }

      try {
        const unpublished = unpublishedFromJsonApi(result.success);
        yield Result.succeed(unpublished);
      } catch (error) {
        yield Result.fail(new InvalidData((error as Error).message));
      }
    } catch (error) {
      yield Result.fail(new InternalError((error as Error).message));
    }
  }

  async *createUnpublished(
    create: UnpublishedCreate,
  ): AsyncGenerator<LaikaResult<Unpublished>> {
    try {
      const jsonApiData = unpublishedCreateToJsonApi(create);
      const headers = await this.getHeaders();

      const response = await fetch(`${this.baseUrl}/unpublished`, {
        method: "POST",
        headers,
        body: JSON.stringify({ data: jsonApiData }),
      });

      const result = await this.handleResponse<UnpublishedJsonApi>(response);
      if (Result.isFailure(result)) {
        yield failAs<Unpublished>(result.failure);
        return;
      }

      try {
        const unpublished = unpublishedFromJsonApi(result.success);
        yield Result.succeed(unpublished);
      } catch (error) {
        yield Result.fail(new InvalidData((error as Error).message));
      }
    } catch (error) {
      yield Result.fail(new InternalError((error as Error).message));
    }
  }

  async *updateUnpublished(
    update: UnpublishedUpdate,
  ): AsyncGenerator<LaikaResult<Unpublished>> {
    try {
      const jsonApiData = unpublishedUpdateToJsonApi(update);
      const headers = await this.getHeaders();

      const response = await fetch(
        `${this.baseUrl}/unpublished/${encodeURIComponent(update.key)}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ data: jsonApiData }),
        },
      );

      const result = await this.handleResponse<UnpublishedJsonApi>(response);
      if (Result.isFailure(result)) {
        yield failAs<Unpublished>(result.failure);
        return;
      }

      try {
        const unpublished = unpublishedFromJsonApi(result.success);
        yield Result.succeed(unpublished);
      } catch (error) {
        yield Result.fail(new InvalidData((error as Error).message));
      }
    } catch (error) {
      yield Result.fail(new InternalError((error as Error).message));
    }
  }

  async *deleteUnpublished(key: string): AsyncGenerator<LaikaResult<void>> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(
        `${this.baseUrl}/unpublished/${encodeURIComponent(key)}`,
        { method: "DELETE", headers },
      );

      yield await this.handleVoidResponse(response);
    } catch (error) {
      yield Result.fail(new InternalError((error as Error).message));
    }
  }

  async *publish(key: string): AsyncGenerator<LaikaResult<Document>> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(
        `${this.baseUrl}/unpublished/${encodeURIComponent(key)}/publish`,
        { method: "POST", headers },
      );

      const result = await this.handleResponse<DocumentJsonApi>(response);
      if (Result.isFailure(result)) {
        yield failAs<Document>(result.failure);
        return;
      }

      try {
        const document = documentFromJsonApi(result.success);
        yield Result.succeed(document);
      } catch (error) {
        yield Result.fail(new InvalidData((error as Error).message));
      }
    } catch (error) {
      yield Result.fail(new InternalError((error as Error).message));
    }
  }

  async *unpublish(key: string, status: string): AsyncGenerator<LaikaResult<Unpublished>> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(
        `${this.baseUrl}/published/${encodeURIComponent(key)}/unpublish`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            data: {
              type: "unpublished",
              attributes: { status },
            },
          }),
        },
      );

      const result = await this.handleResponse<UnpublishedJsonApi>(response);
      if (Result.isFailure(result)) {
        yield failAs<Unpublished>(result.failure);
        return;
      }

      try {
        const unpublished = unpublishedFromJsonApi(result.success);
        yield Result.succeed(unpublished);
      } catch (error) {
        yield Result.fail(new InvalidData((error as Error).message));
      }
    } catch (error) {
      yield Result.fail(new InternalError((error as Error).message));
    }
  }

  // ===== REVISIONS =====
  async *getRevision(key: string, revision: string): AsyncGenerator<LaikaResult<Revision>> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(
        `${this.baseUrl}/revisions/${encodeURIComponent(key)}/${encodeURIComponent(revision)}`,
        { method: "GET", headers },
      );

      const result = await this.handleResponse<RevisionJsonApi>(response);
      if (Result.isFailure(result)) {
        yield failAs<Revision>(result.failure);
        return;
      }

      try {
        const rev = revisionFromJsonApi(result.success);
        yield Result.succeed(rev);
      } catch (error) {
        yield Result.fail(new InvalidData((error as Error).message));
      }
    } catch (error) {
      yield Result.fail(new InternalError((error as Error).message));
    }
  }

  async *createRevision(create: RevisionCreate): AsyncGenerator<LaikaResult<Revision>> {
    try {
      const jsonApiData = revisionCreateToJsonApi(create);
      const headers = await this.getHeaders();

      const response = await fetch(`${this.baseUrl}/revisions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ data: jsonApiData }),
      });

      const result = await this.handleResponse<RevisionJsonApi>(response);
      if (Result.isFailure(result)) {
        yield failAs<Revision>(result.failure);
        return;
      }

      try {
        const rev = revisionFromJsonApi(result.success);
        yield Result.succeed(rev);
      } catch (error) {
        yield Result.fail(new InvalidData((error as Error).message));
      }
    } catch (error) {
      yield Result.fail(new InternalError((error as Error).message));
    }
  }

  async *listRevisions(
    key: string,
    options: ListRevisionsOptions,
  ): AsyncGenerator<LaikaResult<readonly RevisionSummary[]>> {
    try {
      const params = paginationCodec.encode(options.pagination);
      const headers = await this.getHeaders();

      const response = await fetch(
        `${this.baseUrl}/revisions/${encodeURIComponent(key)}?${params}`,
        { method: "GET", headers },
      );

      const contentType = response.headers.get("content-type");
      if (
        !contentType?.includes("application/vnd.api+json") &&
        !contentType?.includes("application/json")
      ) {
        yield Result.fail(new InvalidData(`Expected JSON:API response, got ${contentType}`));
        return;
      }

      const json: JsonApiCollectionResponse = await response.json();

      if (!response.ok || ("errors" in json && Array.isArray(json.errors))) {
        const errors =
          "errors" in json && Array.isArray(json.errors)
            ? json.errors
            : [{ detail: "Unknown error" }];
        yield Result.fail(new InvalidData(
          errors.map((e: { detail?: string; title?: string }) => e.detail || e.title || "Unknown error").join(", "),
        ));
        return;
      }

      const items: RevisionSummary[] = [];
      for (const item of json.data) {
        try {
          const summary = revisionSummaryFromJsonApi(item as RevisionSummaryJsonApi);
          items.push(summary);
        } catch {
          // Skip invalid items
        }
      }

      yield Result.succeed(items);
    } catch (error) {
      yield Result.fail(new InternalError((error as Error).message));
    }
  }
}
