import {
  StorageRepository,
  type Atom,
  type AtomSummary,
  type Folder,
  type FolderCreate,
  type ListAtomsOptions,
  type Pagination,
  type StorageObject,
  type StorageObjectCreate,
  type StorageObjectUpdate,
} from '@laikacms/storage';
import { LaikaResult, LaikaError, InvalidData } from '@laikacms/core';
import * as Result from 'effect/Result';
import {
  storageObjectToJsonApiZ,
  storageObjectFromJsonApiZ,
  storageObjectCreateToJsonApiZ,
  storageObjectUpdateToJsonApiZ,
  folderToJsonApiZ,
  folderFromJsonApiZ,
  folderCreateToJsonApiZ,
  atomSummaryFromJsonApiZ,
  type JsonApiCollectionResponse,
  atomFromJsonApiZ,
} from '@laikacms/storage-api';
import { paginationCodec } from './pagination-codec.js';

function failAs<T>(error: LaikaError): LaikaResult<T> {
  return Result.fail(error);
}

export interface StorageJsonApiProxyRepositoryOptions {
  baseUrl: string;
  authToken?: string;
  /** Dynamic token provider - called before each request */
  tokenPromise?: () => Promise<string>;
}

/**
 * JSON:API Proxy implementation of StorageRepository
 *
 * This implementation proxies all storage operations through a JSON:API
 * endpoint, enabling microservice architecture by communicating with
 * packages/apis/storage-api over HTTP.
 */
export class StorageJsonApiProxyRepository extends StorageRepository {
  private readonly baseUrl: string;
  private readonly staticHeaders: HeadersInit;
  private readonly tokenPromise?: () => Promise<string>;

  constructor(options: StorageJsonApiProxyRepositoryOptions) {
    super();
    this.baseUrl = options.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.tokenPromise = options.tokenPromise;
    this.staticHeaders = {
      'Content-Type': 'application/vnd.api+json',
      'Accept': 'application/vnd.api+json',
      ...(options.authToken ? { 'Authorization': `Bearer ${options.authToken}` } : {}),
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
        'Authorization': `Bearer ${token}`,
      };
    }
    return this.staticHeaders;
  }

  private async handleResponse<T>(response: Response): Promise<LaikaResult<T>> {
    const contentType = response.headers.get('content-type');
    
    if (!contentType?.includes('application/vnd.api+json') && !contentType?.includes('application/json')) {
      return Result.fail(new InvalidData(`Expected JSON:API response, got ${contentType}`));
    }

    const json = await response.json();

    if (!response.ok) {
      const errors = json.errors || [{ detail: 'Unknown error' }];
      return Result.fail(new InvalidData(errors.map((e: any) => e.detail || e.title || 'Unknown error').join(', ')));
    }

    if (json.errors) {
      return Result.fail(new InvalidData(json.errors.map((e: any) => e.detail || e.title || 'Unknown error').join(', ')));
    }

    return Result.succeed(json.data as T);
  }

  async *getObject(key: string): AsyncGenerator<LaikaResult<StorageObject>> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(`${this.baseUrl}/objects/${encodeURIComponent(key)}`, {
        method: 'GET',
        headers,
      });

      const result = await this.handleResponse<any>(response);
      if (Result.isFailure(result)) {
        yield failAs<StorageObject>(result.failure);
        return;
      }

      console.log('getObject - result.success (JSON:API resource):', JSON.stringify(result.success, null, 2));

      // Parse from JSON:API format to domain format
      const parsed = storageObjectFromJsonApiZ.safeParse(result.success);
      console.log('getObject - parsed:', parsed);
      if (!parsed.success) {
        console.error('getObject - parsing errors:', parsed.error.issues);
        yield Result.fail(new InvalidData(parsed.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')));
        return;
      }

      console.log('getObject - parsed.data (domain object):', JSON.stringify(parsed.data, null, 2));
      yield Result.succeed(parsed.data);
    } catch (error) {
      yield Result.fail(new InvalidData(`Network error: ${(error as Error).message}`));
    }
  }

  async *updateObject(update: StorageObjectUpdate): AsyncGenerator<LaikaResult<StorageObject>> {
    try {
      // Transform to JSON:API format
      const jsonApiData = storageObjectUpdateToJsonApiZ.parse(update);
      const headers = await this.getHeaders();

      const response = await fetch(`${this.baseUrl}/objects/${encodeURIComponent(update.key)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ data: jsonApiData }),
      });

      const result = await this.handleResponse<any>(response);
      if (Result.isFailure(result)) {
        yield failAs<StorageObject>(result.failure);
        return;
      }

      // Parse from JSON:API format to domain format
      const parsed = storageObjectFromJsonApiZ.safeParse(result.success);
      if (!parsed.success) {
        yield Result.fail(new InvalidData(parsed.error.issues.map(e => e.message).join(', ')));
        return;
      }

      yield Result.succeed(parsed.data);
    } catch (error) {
      yield Result.fail(new InvalidData(`Network error: ${(error as Error).message}`));
    }
  }

  async *createObject(create: StorageObjectCreate): AsyncGenerator<LaikaResult<StorageObject>> {
    try {
      // Transform to JSON:API format
      const jsonApiData = storageObjectCreateToJsonApiZ.parse(create);
      const headers = await this.getHeaders();

      const response = await fetch(`${this.baseUrl}/atoms`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ data: jsonApiData }),
      });

      const result = await this.handleResponse<any>(response);
      if (Result.isFailure(result)) {
        yield failAs<StorageObject>(result.failure);
        return;
      }

      // Parse from JSON:API format to domain format
      const parsed = storageObjectFromJsonApiZ.safeParse(result.success);
      if (!parsed.success) {
        yield Result.fail(new InvalidData(parsed.error.issues.map(e => e.message).join(', ')));
        return;
      }

      yield Result.succeed(parsed.data);
    } catch (error) {
      yield Result.fail(new InvalidData(`Network error: ${(error as Error).message}`));
    }
  }

  async *createOrUpdateObject(create: StorageObjectCreate): AsyncGenerator<LaikaResult<StorageObject>> {
    // Try to get the object first
    let existing: LaikaResult<StorageObject> | undefined;
    for await (const result of this.getObject(create.key)) {
      existing = result;
    }
    
    if (existing && Result.isSuccess(existing)) {
      // Object exists, update it
      yield* this.updateObject({ ...create, key: create.key });
    } else {
      // Object doesn't exist, create it
      yield* this.createObject(create);
    }
  }

  async *getFolder(key: string): AsyncGenerator<LaikaResult<Folder>> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(`${this.baseUrl}/folders/${encodeURIComponent(key)}`, {
        method: 'GET',
        headers,
      });

      const result = await this.handleResponse<any>(response);
      if (Result.isFailure(result)) {
        yield failAs<Folder>(result.failure);
        return;
      }

      // Parse from JSON:API format to domain format
      const parsed = folderFromJsonApiZ.safeParse(result.success);
      if (!parsed.success) {
        yield Result.fail(new InvalidData(parsed.error.issues.map(e => e.message).join(', ')));
        return;
      }

      yield Result.succeed(parsed.data);
    } catch (error) {
      yield Result.fail(new InvalidData(`Network error: ${(error as Error).message}`));
    }
  }

  listAtoms(folderKey: string, options: ListAtomsOptions): AsyncGenerator<LaikaResult<readonly Atom[]>> {
    return this.listFullAtoms(folderKey, options);
  }

  listAtomSummaries(folderKey: string, options: ListAtomsOptions): AsyncGenerator<LaikaResult<readonly AtomSummary[]>> {
    return this.listAtomSummariesInternal(folderKey, options);
  }

  private async *listFullAtoms(folderKey: string, options: ListAtomsOptions): AsyncGenerator<LaikaResult<readonly Atom[]>> {
    try {
      const params = paginationCodec.encode(options.pagination);

      const url = folderKey
        ? `${this.baseUrl}/atoms/${encodeURIComponent(folderKey)}?${params}`
        : `${this.baseUrl}/atoms?${params}`;

      const headers = await this.getHeaders();
      const response = await fetch(url, {
        method: 'GET',
        headers,
      });

      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('application/vnd.api+json') && !contentType?.includes('application/json')) {
        yield Result.fail(new InvalidData(`Expected JSON:API response, got ${contentType}`));
        return;
      }

      const json: JsonApiCollectionResponse = await response.json();

      console.log('ListAtoms response JSON:', json);

      if (!response.ok || 'errors' in json) {
        const errors = 'errors' in json && Array.isArray(json.errors) ? json.errors : [{ detail: 'Unknown error' }];
        yield Result.fail(new InvalidData(errors.map((e: any) => e.detail || e.title || 'Unknown error').join(', ')));
        return;
      }

      const items: Atom[] = [];
      for (const item of json.data) {
        const parsed = atomFromJsonApiZ.safeParse(item);

        if (parsed.success) {
          items.push(parsed.data);
        } else {
          yield Result.fail(new InvalidData(parsed.error.issues.map(e => e.message).join(', ')));
          return;
        }
      }

      yield Result.succeed(items);
    } catch (error) {
      yield Result.fail(new InvalidData(`Network error: ${(error as Error).message}`));
    }
  }

  private async *listAtomSummariesInternal(folderKey: string, options: ListAtomsOptions): AsyncGenerator<LaikaResult<readonly AtomSummary[]>> {
    try {
      const params = paginationCodec.encode(options.pagination);

      const url = folderKey
        ? `${this.baseUrl}/atom-summaries/${encodeURIComponent(folderKey)}?${params}`
        : `${this.baseUrl}/atom-summaries?${params}`;

      const headers = await this.getHeaders();
      const response = await fetch(url, {
        method: 'GET',
        headers,
      });

      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('application/vnd.api+json') && !contentType?.includes('application/json')) {
        yield Result.fail(new InvalidData(`Expected JSON:API response, got ${contentType}`));
        return;
      }

      const json: JsonApiCollectionResponse = await response.json();

      console.log('ListAtomSummaries response JSON:', json);

      if (!response.ok || 'errors' in json) {
        const errors = 'errors' in json && Array.isArray(json.errors) ? json.errors : [{ detail: 'Unknown error' }];
        yield Result.fail(new InvalidData(errors.map((e: any) => e.detail || e.title || 'Unknown error').join(', ')));
        return;
      }

      const items: AtomSummary[] = [];
      for (const item of json.data) {
        const parsed = atomSummaryFromJsonApiZ.safeParse(item);

        if (parsed.success) {
          items.push(parsed.data);
        } else {
          yield Result.fail(new InvalidData(parsed.error.issues.map(e => e.message).join(', ')));
          return;
        }
      }

      yield Result.succeed(items);
    } catch (error) {
      yield Result.fail(new InvalidData(`Network error: ${(error as Error).message}`));
    }
  }

  async *createFolder(folderCreate: FolderCreate): AsyncGenerator<LaikaResult<Folder>> {
    try {
      // Transform to JSON:API format
      const jsonApiData = folderCreateToJsonApiZ.parse(folderCreate);
      const headers = await this.getHeaders();

      const response = await fetch(`${this.baseUrl}/atoms`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ data: jsonApiData }),
      });

      const result = await this.handleResponse<any>(response);
      if (Result.isFailure(result)) {
        yield failAs<Folder>(result.failure);
        return;
      }

      // Parse from JSON:API format to domain format
      const parsed = folderFromJsonApiZ.safeParse(result.success);
      if (!parsed.success) {
        yield Result.fail(new InvalidData(parsed.error.issues.map(e => e.message).join(', ')));
        return;
      }

      yield Result.succeed(parsed.data);
    } catch (error) {
      yield Result.fail(new InvalidData(`Network error: ${(error as Error).message}`));
    }
  }

  async *getAtom(key: string): AsyncGenerator<LaikaResult<Atom>> {
    // Try to get as object first, then as folder
    let objectResult: LaikaResult<StorageObject> | undefined;
    for await (const result of this.getObject(key)) {
      objectResult = result;
    }
    
    if (objectResult && Result.isSuccess(objectResult)) {
      yield objectResult;
      return;
    }

    yield* this.getFolder(key);
  }

  async *removeAtoms(keys: readonly string[]): AsyncGenerator<LaikaResult<readonly string[]>> {
    try {
      // Build atomic operations for removal
      const operations = keys.map(key => ({
        op: 'remove' as const,
        ref: {
          type: 'atom' as const,
          id: key,
        },
      }));

      const headers = await this.getHeaders();
      const response = await fetch(`${this.baseUrl}/operations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ 'atomic:operations': operations }),
      });

      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('application/vnd.api+json') && !contentType?.includes('application/json')) {
        yield Result.fail(new InvalidData(`Expected JSON:API response, got ${contentType}`));
        return;
      }

      const json = await response.json();

      if (!response.ok) {
        const errors = json.errors || [{ detail: 'Unknown error' }];
        yield Result.fail(new InvalidData(errors.map((e: any) => e.detail || e.title || 'Unknown error').join(', ')));
        return;
      }

      // Extract successfully removed keys
      const removedKeys: string[] = [];
      const results = json['atomic:results'] || [];
      
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (!result.errors) {
          removedKeys.push(keys[i]);
        }
      }

      yield Result.succeed(removedKeys);
    } catch (error) {
      yield Result.fail(new InvalidData(`Network error: ${(error as Error).message}`));
    }
  }
}
