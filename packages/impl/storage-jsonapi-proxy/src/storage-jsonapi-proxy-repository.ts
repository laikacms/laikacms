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
import { Result, success, failure, InvalidData } from '@laikacms/core';
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

  private async handleResponse<T>(response: Response): Promise<Result<T>> {
    const contentType = response.headers.get('content-type');
    
    if (!contentType?.includes('application/vnd.api+json') && !contentType?.includes('application/json')) {
      return failure(InvalidData.CODE, [`Expected JSON:API response, got ${contentType}`]);
    }

    const json = await response.json();

    if (!response.ok) {
      const errors = json.errors || [{ detail: 'Unknown error' }];
      return failure(InvalidData.CODE, errors.map((e: any) => e.detail || e.title || 'Unknown error'));
    }

    if (json.errors) {
      return failure(InvalidData.CODE, json.errors.map((e: any) => e.detail || e.title || 'Unknown error'));
    }

    return success(json.data as T);
  }

  async getObject(key: string): Promise<Result<StorageObject>> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(`${this.baseUrl}/objects/${encodeURIComponent(key)}`, {
        method: 'GET',
        headers,
      });

      const result = await this.handleResponse<any>(response);
      if (!result.success) return result;

      console.log('getObject - result.data (JSON:API resource):', JSON.stringify(result.data, null, 2));

      // Parse from JSON:API format to domain format
      const parsed = storageObjectFromJsonApiZ.safeParse(result.data);
      console.log('getObject - parsed:', parsed);
      if (!parsed.success) {
        console.error('getObject - parsing errors:', parsed.error.issues);
        return failure(InvalidData.CODE, parsed.error.issues.map(e => `${e.path.join('.')}: ${e.message}`));
      }

      console.log('getObject - parsed.data (domain object):', JSON.stringify(parsed.data, null, 2));
      return success(parsed.data);
    } catch (error) {
      return failure(InvalidData.CODE, [`Network error: ${(error as Error).message}`]);
    }
  }

  async updateObject(update: StorageObjectUpdate): Promise<Result<StorageObject>> {
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
      if (!result.success) return result;

      // Parse from JSON:API format to domain format
      const parsed = storageObjectFromJsonApiZ.safeParse(result.data);
      if (!parsed.success) {
        return failure(InvalidData.CODE, parsed.error.issues.map(e => e.message));
      }

      return success(parsed.data);
    } catch (error) {
      return failure(InvalidData.CODE, [`Network error: ${(error as Error).message}`]);
    }
  }

  async createObject(create: StorageObjectCreate): Promise<Result<StorageObject>> {
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
      if (!result.success) return result;

      // Parse from JSON:API format to domain format
      const parsed = storageObjectFromJsonApiZ.safeParse(result.data);
      if (!parsed.success) {
        return failure(InvalidData.CODE, parsed.error.issues.map(e => e.message));
      }

      return success(parsed.data);
    } catch (error) {
      return failure(InvalidData.CODE, [`Network error: ${(error as Error).message}`]);
    }
  }

  async createOrUpdateObject(create: StorageObjectCreate): Promise<Result<StorageObject>> {
    // Try to get the object first
    const existing = await this.getObject(create.key);
    
    if (existing.success) {
      // Object exists, update it
      return this.updateObject({ ...create, key: create.key });
    } else {
      // Object doesn't exist, create it
      return this.createObject(create);
    }
  }

  async getFolder(key: string): Promise<Result<Folder>> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(`${this.baseUrl}/folders/${encodeURIComponent(key)}`, {
        method: 'GET',
        headers,
      });

      const result = await this.handleResponse<any>(response);
      if (!result.success) return result;

      // Parse from JSON:API format to domain format
      const parsed = folderFromJsonApiZ.safeParse(result.data);
      if (!parsed.success) {
        return failure(InvalidData.CODE, parsed.error.issues.map(e => e.message));
      }

      return success(parsed.data);
    } catch (error) {
      return failure(InvalidData.CODE, [`Network error: ${(error as Error).message}`]);
    }
  }

  listAtoms(folderKey: string, options: ListAtomsOptions): AsyncGenerator<Result<readonly Atom[]>> {
    return this.listAllAtoms<Atom>(folderKey, options, false);
  }

  listAtomSummaries(folderKey: string, options: ListAtomsOptions): AsyncGenerator<Result<readonly AtomSummary[]>> {
    return this.listAllAtoms<AtomSummary>(folderKey, options, true);
  }

  private async *listAllAtoms<T extends AtomSummary | Atom>(folderKey: string, options: ListAtomsOptions, summaryOnly: boolean): AsyncGenerator<Result<readonly T[]>> {
    try {
      const params = paginationCodec.encode(options.pagination);

      const resourceType = summaryOnly ? 'atom-summaries' : 'atoms';

      const url = folderKey
        ? `${this.baseUrl}/${resourceType}/${encodeURIComponent(folderKey)}?${params}`
        : `${this.baseUrl}/${resourceType}?${params}`;

      const headers = await this.getHeaders();
      const response = await fetch(url, {
        method: 'GET',
        headers,
      });

      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('application/vnd.api+json') && !contentType?.includes('application/json')) {
        yield failure(InvalidData.CODE, [`Expected JSON:API response, got ${contentType}`]);
        return;
      }

      const json: JsonApiCollectionResponse = await response.json();

      console.log('ListAtoms response JSON:', json);

      if (!response.ok || 'errors' in json) {
        const errors = 'errors' in json && Array.isArray(json.errors) ? json.errors : [{ detail: 'Unknown error' }];
        yield failure(InvalidData.CODE, errors.map((e: any) => e.detail || e.title || 'Unknown error'));
        return;
      }

      const items: T[] = [];
      for (const item of json.data) {
        const parsed = summaryOnly ? atomSummaryFromJsonApiZ.safeParse(item) : atomFromJsonApiZ.safeParse(item);

        if (parsed.success) {
          items.push(parsed.data as T);
        } else {
          yield failure(InvalidData.CODE, parsed.error.issues.map(e => e.message));
        }
      }

      yield success(items);
    } catch (error) {
      yield failure(InvalidData.CODE, [`Network error: ${(error as Error).message}`]);
    }
  }

  async createFolder(folderCreate: FolderCreate): Promise<Result<Folder>> {
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
      if (!result.success) return result;

      // Parse from JSON:API format to domain format
      const parsed = folderFromJsonApiZ.safeParse(result.data);
      if (!parsed.success) {
        return failure(InvalidData.CODE, parsed.error.issues.map(e => e.message));
      }

      return success(parsed.data);
    } catch (error) {
      return failure(InvalidData.CODE, [`Network error: ${(error as Error).message}`]);
    }
  }

  async getAtom(key: string): Promise<Result<Atom>> {
    // Try to get as object first, then as folder
    const objectResult = await this.getObject(key);
    if (objectResult.success) {
      return objectResult;
    }

    return this.getFolder(key);
  }

  async *removeAtoms(keys: readonly string[]): AsyncGenerator<Result<readonly string[]>> {
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
        yield failure(InvalidData.CODE, [`Expected JSON:API response, got ${contentType}`]);
        return;
      }

      const json = await response.json();

      if (!response.ok) {
        const errors = json.errors || [{ detail: 'Unknown error' }];
        yield failure(InvalidData.CODE, errors.map((e: any) => e.detail || e.title || 'Unknown error'));
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

      yield success(removedKeys);
    } catch (error) {
      yield failure(InvalidData.CODE, [`Network error: ${(error as Error).message}`]);
    }
  }
}
