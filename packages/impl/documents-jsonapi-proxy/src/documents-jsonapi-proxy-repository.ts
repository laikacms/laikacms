import {
  failure,
  IllegalStateException,
  InternalError,
  InvalidData,
  Result,
  ResultError,
  success,
} from "@laikacms/core";
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
  documentCreateToJsonApiZ,
  documentUpdateToJsonApiZ,
  documentFromJsonApiZ,
  documentSummaryFromJsonApiZ,
  revisionCreateToJsonApiZ,
  revisionFromJsonApiZ,
  revisionSummaryFromJsonApiZ,
  unpublishedCreateToJsonApiZ,
  unpublishedFromJsonApiZ,
  unpublishedSummaryFromJsonApiZ,
  unpublishedUpdateToJsonApiZ,
  type JsonApiCollectionResponse,
} from "@laikacms/documents-api";
import { paginationCodec } from "./pagination-codec.js";
import { errorFromResponse } from "@laikacms/json-api";

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

  private async handleResponse<T>(response: Response): Promise<Result<T>> {
    const contentType = response.headers.get("content-type");

    if (
      !contentType?.includes("application/vnd.api+json") &&
      !contentType?.includes("application/json")
    ) {
      return failure(InvalidData.CODE, [
        `Expected JSON:API response, got ${contentType}`,
      ]);
    }

    const json = await response.json();

    if (!response.ok) {
      const errorResult = await errorFromResponse(response);
      return failure(errorResult.code, [errorResult.message]);
    }

    if ("errors" in json && Array.isArray(json.errors)) {
      return failure(
        InvalidData.CODE,
        json.errors.map((e: any) => e.detail || e.title || "Unknown error"),
      );
    }

    return success(json.data as T);
  }

  private async handleVoidResponse(response: Response): Promise<Result<void>> {
    const contentType = response.headers.get("content-type");

    if (
      !contentType?.includes("application/vnd.api+json") &&
      !contentType?.includes("application/json")
    ) {
      return failure(InvalidData.CODE, [
        `Expected JSON:API response, got ${contentType}`,
      ]);
    }

    const json = await response.json();

    if (!response.ok) {
      const errors =
        "errors" in json && Array.isArray(json.errors)
          ? json.errors
          : [{ detail: "Unknown error" }];
      return failure(
        InvalidData.CODE,
        errors.map((e: any) => e.detail || e.title || "Unknown error"),
      );
    }

    if ("errors" in json && Array.isArray(json.errors)) {
      return failure(
        InvalidData.CODE,
        json.errors.map((e: any) => e.detail || e.title || "Unknown error"),
      );
    }

    return success(undefined);
  }

  // ===== RECORDS =====

  /**
   * Private helper to list records with configurable output type
   */
  private async *listRecordsInternal<
    Mode extends "full" | "summary",
    T extends Mode extends "full" ? Record : RecordSummary,
  >(
    options: ListRecordsOptions,
    mode: Mode,
  ): AsyncGenerator<Result<readonly T[]>> {
    try {
      const params = paginationCodec.encode(options.pagination);
      if (options.type) {
        params.set("filter[type]", options.type);
      }
      params.set('filter[depth]', '' + options.depth)
      params.set("filter[folder]", options.folder);

      const headers = await this.getHeaders();
      const response = await fetch(`${this.baseUrl}/${mode === 'full' ? 'records' : 'record-summaries'}?${params}`, {
        method: "GET",
        headers,
      });

      const contentType = response.headers.get("content-type");
      if (
        !contentType?.includes("application/vnd.api+json") &&
        !contentType?.includes("application/json")
      ) {
        yield failure(InvalidData.CODE, [
          `Expected JSON:API response, got ${contentType}`,
        ]) as any;
        return;
      }

      const json: JsonApiCollectionResponse = await response.json();

      if (!response.ok || ("errors" in json && Array.isArray(json.errors))) {
        const errors =
          "errors" in json && Array.isArray(json.errors)
            ? json.errors
            : [{ detail: "Unknown error" }];
        yield failure(
          InvalidData.CODE,
          errors.map((e: any) => e.detail || e.title || "Unknown error"),
        ) as any;
        return;
      }

      // Parse each item based on its type and mode
      const items: T[] = [];
      for (const item of json.data) {
        let parsed;
        if (mode === "full") {
          switch (item.type) {
            case "published":
              parsed = documentFromJsonApiZ.safeParse(item);
              break;
            case "unpublished":
              parsed = unpublishedFromJsonApiZ.safeParse(item);
              break;
            case "revision":
              parsed = revisionFromJsonApiZ.safeParse(item);
              break;
            case "folder":
              continue;
            default:
              throw new IllegalStateException("Unknown record type: " + item.type);
          }
        } else {
          switch (item.type) {
            case "published":
            case "published-summary":
              parsed = documentSummaryFromJsonApiZ.safeParse(item);
              break;
            case "unpublished":
            case "unpublished-summary":
              parsed = unpublishedSummaryFromJsonApiZ.safeParse(item);
              break;
            case "revision":
            case "revision-summary":
              parsed = revisionSummaryFromJsonApiZ.safeParse(item);
              break;
            case "folder":
              continue;
            default:
              throw new IllegalStateException("Unknown record type: " + item.type);
          }
        }

        if (parsed.success) {
          items.push(parsed.data as T);
        } else {
          yield failure(
            InvalidData.CODE,
            parsed.error.issues.map((e) => e.message),
          ) as any;
        }
      }

      yield success(items) as any;
    } catch (error) {
      yield ResultError.fromError(error).toResult() as any;
    }
  }

  /**
   * List full record objects with content
   */
  listRecords(
    options: ListRecordsOptions,
  ): AsyncGenerator<Result<readonly Record[]>> {
    return this.listRecordsInternal(options, "full");
  }

  /**
   * List record summaries (without content) for efficient listing
   */
  listRecordSummaries(
    options: ListRecordsOptions,
  ): AsyncGenerator<Result<readonly RecordSummary[]>> {
    return this.listRecordsInternal(options, "summary");
  }

  // ===== DOCUMENTS (PUBLISHED) =====
  async getDocument(key: string): Promise<Result<Document>> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(
        `${this.baseUrl}/published/${encodeURIComponent(key)}`,
        { method: "GET", headers },
      );

      const result = await this.handleResponse<any>(response);
      if (!result.success) return result;

      const parsed = documentFromJsonApiZ.safeParse(result.data);
      if (!parsed.success) {
        return failure(
          InvalidData.CODE,
          parsed.error.issues.map((e: any) => e.message),
        );
      }

      return success(parsed.data);
    } catch (error) {
      return ResultError.fromError(error).toResult();
    }
  }

  async createDocument(create: DocumentCreate): Promise<Result<Document>> {
    try {
      const jsonApiData = documentCreateToJsonApiZ.parse(create);
      console.log("Creating document with JSON:API data:", jsonApiData);
      const headers = await this.getHeaders();

      const response = await fetch(`${this.baseUrl}/published`, {
        method: "POST",
        headers,
        body: JSON.stringify({ data: jsonApiData }),
      });

      const result = await this.handleResponse<any>(response);
      if (!result.success) return result;

      const parsed = documentFromJsonApiZ.safeParse(result.data);
      if (!parsed.success) {
        return failure(
          InvalidData.CODE,
          parsed.error.issues.map((e: any) => e.message),
        );
      }

      return success(parsed.data);
    } catch (error) {
      return ResultError.fromError(error).toResult();
    }
  }

  async updateDocument(update: DocumentUpdate): Promise<Result<Document>> {
    try {
      const jsonApiData = documentUpdateToJsonApiZ.parse(update);
      const headers = await this.getHeaders();

      const response = await fetch(
        `${this.baseUrl}/published/${encodeURIComponent(update.key)}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ data: jsonApiData }),
        },
      );

      const result = await this.handleResponse<any>(response);
      if (!result.success) return result;

      const parsed = documentFromJsonApiZ.safeParse(result.data);
      if (!parsed.success) {
        return failure(
          InvalidData.CODE,
          parsed.error.issues.map((e: any) => e.message),
        );
      }

      return success(parsed.data);
    } catch (error) {
      return ResultError.fromError(error).toResult();
    }
  }

  async deleteDocument(key: string): Promise<Result<void>> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(
        `${this.baseUrl}/published/${encodeURIComponent(key)}`,
        { method: "DELETE", headers },
      );

      return this.handleVoidResponse(response);
    } catch (error) {
      return ResultError.fromError(error).toResult();
    }
  }

  // ===== UNPUBLISHED =====
  async getUnpublished(key: string): Promise<Result<Unpublished>> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(
        `${this.baseUrl}/unpublished/${encodeURIComponent(key)}`,
        { method: "GET", headers },
      );

      const result = await this.handleResponse<any>(response);
      if (!result.success) return result;

      const parsed = unpublishedFromJsonApiZ.safeParse(result.data);
      if (!parsed.success) {
        return failure(
          InvalidData.CODE,
          parsed.error.issues.map((e: any) => e.message),
        );
      }

      return success(parsed.data);
    } catch (error) {
      return ResultError.fromError(error).toResult();
    }
  }

  async createUnpublished(
    create: UnpublishedCreate,
  ): Promise<Result<Unpublished>> {
    try {
      const jsonApiData = unpublishedCreateToJsonApiZ.parse(create);
      const headers = await this.getHeaders();

      const response = await fetch(`${this.baseUrl}/unpublished`, {
        method: "POST",
        headers,
        body: JSON.stringify({ data: jsonApiData }),
      });

      const result = await this.handleResponse<any>(response);
      if (!result.success) return result;

      const parsed = unpublishedFromJsonApiZ.safeParse(result.data);
      if (!parsed.success) {
        return failure(
          InvalidData.CODE,
          parsed.error.issues.map((e: any) => e.message),
        );
      }

      return success(parsed.data);
    } catch (error) {
      return ResultError.fromError(error).toResult();
    }
  }

  async updateUnpublished(
    update: UnpublishedUpdate,
  ): Promise<Result<Unpublished>> {
    try {
      const jsonApiData = unpublishedUpdateToJsonApiZ.parse(update);
      const headers = await this.getHeaders();

      const response = await fetch(
        `${this.baseUrl}/unpublished/${encodeURIComponent(update.key)}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ data: jsonApiData }),
        },
      );

      const result = await this.handleResponse<any>(response);
      if (!result.success) return result;

      const parsed = unpublishedFromJsonApiZ.safeParse(result.data);
      if (!parsed.success) {
        return failure(
          InvalidData.CODE,
          parsed.error.issues.map((e: any) => e.message),
        );
      }

      return success(parsed.data);
    } catch (error) {
      return ResultError.fromError(error).toResult();
    }
  }

  async deleteUnpublished(key: string): Promise<Result<void>> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(
        `${this.baseUrl}/unpublished/${encodeURIComponent(key)}`,
        { method: "DELETE", headers },
      );

      return this.handleVoidResponse(response);
    } catch (error) {
      return ResultError.fromError(error).toResult();
    }
  }

  async publish(key: string): Promise<Result<Document>> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(
        `${this.baseUrl}/unpublished/${encodeURIComponent(key)}/publish`,
        { method: "POST", headers },
      );

      const result = await this.handleResponse<any>(response);
      if (!result.success) return result;

      const parsed = documentFromJsonApiZ.safeParse(result.data);
      if (!parsed.success) {
        return failure(
          InvalidData.CODE,
          parsed.error.issues.map((e: any) => e.message),
        );
      }

      return success(parsed.data);
    } catch (error) {
      return ResultError.fromError(error).toResult();
    }
  }

  async unpublish(key: string, status: string): Promise<Result<Unpublished>> {
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

      const result = await this.handleResponse<any>(response);
      if (!result.success) return result;

      const parsed = unpublishedFromJsonApiZ.safeParse(result.data);
      if (!parsed.success) {
        return failure(
          InvalidData.CODE,
          parsed.error.issues.map((e: any) => e.message),
        );
      }

      return success(parsed.data);
    } catch (error) {
      return ResultError.fromError(error).toResult();
    }
  }

  // ===== REVISIONS =====
  async getRevision(key: string, revision: string): Promise<Result<Revision>> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(
        `${this.baseUrl}/revisions/${encodeURIComponent(key)}/${encodeURIComponent(revision)}`,
        { method: "GET", headers },
      );

      const result = await this.handleResponse<any>(response);
      if (!result.success) return result;

      const parsed = revisionFromJsonApiZ.safeParse(result.data);
      if (!parsed.success) {
        return failure(
          InvalidData.CODE,
          parsed.error.issues.map((e: any) => e.message),
        );
      }

      return success(parsed.data);
    } catch (error) {
      return ResultError.fromError(error).toResult();
    }
  }

  async createRevision(create: RevisionCreate): Promise<Result<Revision>> {
    try {
      const jsonApiData = revisionCreateToJsonApiZ.parse(create);
      const headers = await this.getHeaders();

      const response = await fetch(`${this.baseUrl}/revisions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ data: jsonApiData }),
      });

      const result = await this.handleResponse<any>(response);
      if (!result.success) return result;

      const parsed = revisionFromJsonApiZ.safeParse(result.data);
      if (!parsed.success) {
        return failure(
          InvalidData.CODE,
          parsed.error.issues.map((e: any) => e.message),
        );
      }

      return success(parsed.data);
    } catch (error) {
      return ResultError.fromError(error).toResult();
    }
  }

  async *listRevisions(
    key: string,
    options: ListRevisionsOptions,
  ): AsyncGenerator<Result<readonly RevisionSummary[]>> {
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
        yield failure(InvalidData.CODE, [
          `Expected JSON:API response, got ${contentType}`,
        ]);
        return;
      }

      const json: JsonApiCollectionResponse = await response.json();

      if (!response.ok || ("errors" in json && Array.isArray(json.errors))) {
        const errors =
          "errors" in json && Array.isArray(json.errors)
            ? json.errors
            : [{ detail: "Unknown error" }];
        yield failure(
          InvalidData.CODE,
          errors.map((e: any) => e.detail || e.title || "Unknown error"),
        );
        return;
      }

      const items: RevisionSummary[] = [];
      for (const item of json.data) {
        const parsed = revisionSummaryFromJsonApiZ.safeParse(item);
        if (parsed.success) {
          items.push(parsed.data);
        }
      }

      yield success(items);
    } catch (error) {
      yield ResultError.fromError(error).toResult();
    }
  }
}
