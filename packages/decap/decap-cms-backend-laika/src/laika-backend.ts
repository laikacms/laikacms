import { AccessTokenError, APIError, unsentRequest } from 'decap-cms-lib-util';

import PKCEAuthenticationPage from './AuthenticationPage';

import type {
  AssetProxy,
  Config,
  Credentials,
  Cursor,
  DisplayURL,
  Entry,
  Implementation,
  ImplementationEntry,
  ImplementationFile,
  ImplementationMediaFile,
  PersistOptions,
  UnpublishedEntry,
  User,
} from 'decap-cms-lib-util';

import type { AssetCreate, AssetsRepository } from '@laikacms/assets';
import { AssetsJsonApiProxyRepository } from '@laikacms/assets-jsonapi-proxy';
import type { ErrorCode, LaikaError, LaikaResult } from '@laikacms/core';
import {
  AsyncGenerator,
  errorCode,
  ErrorCodeToStatusMap,
  IllegalStateException,
  TemplateLiteral as TL,
  Url,
} from '@laikacms/core';
import type { DocumentsRepository } from '@laikacms/documents';
import { DocumentsJsonApiProxyRepository } from '@laikacms/documents-jsonapi-proxy';
import type { Pagination } from '@laikacms/storage';
import * as Result from 'effect/Result';

// Helper to get first result from async generator
async function firstResult<T>(gen: AsyncGenerator<LaikaResult<T>>): Promise<LaikaResult<T>> {
  const { value, done } = await gen.next();
  if (done || value === undefined) {
    return Result.fail({ code: errorCode.NOT_FOUND, message: 'No result returned' } as any);
  }
  return value;
}

/**
 * Configuration for the Laika backend
 */
export interface LaikaBackendConfig {
  /** API URL for authentication and settings */
  apiUrl: string;
  /** Media folder path */
  mediaFolder: string;
  /** Allowed roles for access control */
  acceptRoles?: string[];
}

/**
 * Options for getting a documents repository
 */
export interface GetDocumentsRepositoryOptions {
  tokenPromise: () => Promise<string>;
  /** Base URL for the API (apiUrl) */
  baseUrl: string;
}

/**
 * Options for getting an assets repository
 */
export interface GetAssetsRepositoryOptions {
  tokenPromise: () => Promise<string>;
  /** Base URL for the API (apiUrl) */
  baseUrl: string;
}

/**
 * Options for creating a Laika backend
 */
export interface CreateLaikaBackendOptions {
  /**
   * Factory function to create a DocumentsRepository.
   * Defaults to creating a DocumentsJsonApiProxyRepository.
   * The repository handles all collections - routing can be done internally if needed.
   */
  getDocumentsRepository?: (options: GetDocumentsRepositoryOptions) => DocumentsRepository;

  /**
   * Factory function to create an AssetsRepository for media/binary files.
   * Defaults to creating an AssetsJsonApiProxyRepository.
   */
  getAssetsRepository?: (options: GetAssetsRepositoryOptions) => AssetsRepository;

  /**
   * Base URL for the documents API (used by default factory)
   */
  documentsApiBaseUrl?: string;

  /**
   * Base URL for the storage API (used by default factory)
   * @deprecated Use assetsApiBaseUrl instead
   */
  storageApiBaseUrl?: string;

  /**
   * Base URL for the assets API (used by default factory)
   */
  assetsApiBaseUrl?: string;
}

/**
 * Creates a Laika CMS backend implementation with dependency injection
 * for storage and documents repositories.
 *
 * @param options - Configuration options including repository factories
 * @returns A class that implements the Decap CMS Implementation interface
 */
export default function createLaikaBackend(
  options: CreateLaikaBackendOptions = {},
): new(config: Config, opts?: Record<string, unknown>) => Implementation {
  const {
    getDocumentsRepository: customGetDocumentsRepository,
    getAssetsRepository: customGetAssetsRepository,
    documentsApiBaseUrl,
    assetsApiBaseUrl,
  } = options;

  console.log('Creating Laika Backend with options:', { options });

  /**
   * Default factory for DocumentsRepository using JSON:API proxy
   * Uses baseUrl/documents pattern (collection is passed via filter[folder])
   */
  const defaultGetDocumentsRepository = (opts: GetDocumentsRepositoryOptions): DocumentsRepository => {
    // Use explicit documentsApiBaseUrl if provided, otherwise derive from baseUrl
    const baseUrl = documentsApiBaseUrl || `${opts.baseUrl}/documents`;

    return new DocumentsJsonApiProxyRepository({
      baseUrl,
      tokenPromise: opts.tokenPromise,
    });
  };

  /**
   * Default factory for AssetsRepository using JSON:API proxy
   * Uses baseUrl/assets pattern
   */
  const defaultGetAssetsRepository = (opts: GetAssetsRepositoryOptions): AssetsRepository => {
    // Use explicit assetsApiBaseUrl if provided, otherwise derive from baseUrl
    const baseUrl = assetsApiBaseUrl || `${opts.baseUrl}/assets`;

    return new AssetsJsonApiProxyRepository({
      baseUrl,
      tokenPromise: opts.tokenPromise,
    });
  };

  const getDocumentsRepository = customGetDocumentsRepository || defaultGetDocumentsRepository;
  const getAssetsRepository = customGetAssetsRepository || defaultGetAssetsRepository;

  /**
   * Normalize a document key by removing file extensions
   * Decap CMS sends keys like "articles/test.json" but we store them as "articles/test"
   */
  const normalizeKey = (key: string): string => {
    // Remove common file extensions used by Decap CMS
    return key.replace(/\.(json|yaml|yml|md|markdown|toml)$/i, '');
  };

  /**
   * Convert content to raw string format for Decap CMS
   * Decap CMS expects the `data` field to be a raw string (the file content as stored on disk)
   * For JSON files, this is the JSON string; for YAML/frontmatter files, it's the raw text
   */
  const contentToRawString = (content: unknown): string => {
    if (typeof content === 'string') {
      // Content is already a string (e.g., raw file content)
      return content;
    }
    // Content is an object, stringify it for JSON format
    const result = JSON.stringify(content);
    return result;
  };

  /**
   * Request deduplication cache to reduce duplicate requests
   * Decap CMS makes many redundant requests in parallel, this helps reduce API load
   * by returning the same promise for concurrent requests to the same resource
   */
  interface CacheEntry<T> {
    data: T;
    timestamp: number;
  }

  const CACHE_TTL = 5000; // 5 seconds cache TTL

  class DedupeCache<T> {
    private cache = new Map<string, CacheEntry<T>>();
    private pending = new Map<string, Promise<T>>();

    get(key: string): T | undefined {
      const entry = this.cache.get(key);
      if (!entry) return undefined;
      if (Date.now() - entry.timestamp > CACHE_TTL) {
        this.cache.delete(key);
        return undefined;
      }
      return entry.data;
    }

    set(key: string, data: T): void {
      this.cache.set(key, { data, timestamp: Date.now() });
    }

    /**
     * Get or fetch with deduplication
     * If a request is already in-flight, return the same promise
     */
    async getOrFetch(key: string, fetcher: () => Promise<T>): Promise<T> {
      // Check cache first
      const cached = this.get(key);
      if (cached !== undefined) {
        return cached;
      }

      // Check if request is already in-flight
      const pending = this.pending.get(key);
      if (pending) {
        return pending;
      }

      // Start new request
      const promise = fetcher().then(
        data => {
          this.set(key, data);
          this.pending.delete(key);
          return data;
        },
        error => {
          this.pending.delete(key);
          throw error;
        },
      );

      this.pending.set(key, promise);
      return promise;
    }

    clear(): void {
      this.cache.clear();
      // Don't clear pending - let them complete
    }

    invalidate(keyPrefix: string): void {
      for (const key of this.cache.keys()) {
        if (key.startsWith(keyPrefix)) {
          this.cache.delete(key);
        }
      }
    }
  }

  /**
   * Laika CMS Backend Implementation
   *
   * Uses DocumentsRepository for all document operations (entries, unpublished, etc.)
   * and StorageRepository for media file operations.
   */
  return class LaikaBackend implements Implementation {
    config: Config;
    mediaFolder: string;
    publicFolder: string;
    apiUrl: string;
    acceptRoles?: string[];
    tokenPromise?: () => Promise<string>;
    baseUrl: string;

    assetsRepository?: AssetsRepository;
    documentsRepository?: DocumentsRepository;

    // Caches to reduce duplicate requests
    entryCache = new DedupeCache<ImplementationEntry>();
    unpublishedEntryCache = new DedupeCache<UnpublishedEntry>();
    unpublishedEntriesListCache = new DedupeCache<string[]>();

    constructor(config: Config, _options: Record<string, unknown> = {}) {
      this.config = config;
      this.mediaFolder = config.media_folder;
      // IMPORTANT
      // public_folder is used for the path that appears in content
      // When not set, we use media_folder so paths match what Decap CMS expects
      this.publicFolder = (config as any).public_folder ?? config.media_folder;

      this.baseUrl = Url.normalize(config.backend.base_url);
      this.apiUrl = Url.combine(this.baseUrl, config.backend.api_root);
    }

    isGitBackend() {
      return false;
    }

    /**
     * Get file extension from MIME type
     */
    private getExtensionFromMimeType(mimeType: string): string | null {
      const mimeToExt: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/svg+xml': 'svg',
        'image/bmp': 'bmp',
        'image/tiff': 'tiff',
        'image/avif': 'avif',
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'video/ogg': 'ogv',
        'audio/mpeg': 'mp3',
        'audio/ogg': 'ogg',
        'audio/wav': 'wav',
        'application/pdf': 'pdf',
        'application/json': 'json',
        'text/plain': 'txt',
        'text/html': 'html',
        'text/css': 'css',
        'text/javascript': 'js',
        'application/zip': 'zip',
      };
      return mimeToExt[mimeType] || null;
    }

    async status() {
      try {
        const response = await fetch(`${this.apiUrl}/health`);
        const api = response.ok;

        let auth = false;
        if (api && this.tokenPromise) {
          try {
            const token = await this.tokenPromise();
            auth = !!token;
          } catch (e) {
            console.warn('Failed getting access token', e);
            auth = false;
          }
        }

        return {
          auth: { status: auth },
          api: { status: api, statusPage: this.apiUrl },
        };
      } catch (e) {
        console.warn('Failed getting Laika Backend status', e);
        return {
          auth: { status: false },
          api: { status: false, statusPage: this.apiUrl },
        };
      }
    }

    authComponent(): unknown {
      return PKCEAuthenticationPage;
    }

    private static SESSION_TOKEN_KEY = 'laika_access_token';

    restoreUser() {
      // Try to restore user from session storage
      const storedToken = typeof sessionStorage !== 'undefined'
        ? sessionStorage.getItem(LaikaBackend.SESSION_TOKEN_KEY)
        : null;

      if (!storedToken) {
        return Promise.reject(
          new AccessTokenError('User session expired. Please log in again.'),
        );
      }

      // Re-authenticate with the stored token
      return this.authenticate({ token: storedToken } as Credentials);
    }

    async authenticate(credentials: Credentials) {
      const user = credentials;
      const token = user.token || (user as any).access_token;

      if (!token) {
        throw new AccessTokenError('No access token provided');
      }

      this.tokenPromise = () => Promise.resolve(token as string);

      try {
        // Fetch session data from the /session endpoint
        const sessionResponse = await unsentRequest.fetchWithTimeout(
          TL.url`${this.apiUrl}/session`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        if (!sessionResponse.ok) {
          // If token is invalid, clear stored token
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.removeItem(LaikaBackend.SESSION_TOKEN_KEY);
          }
          const errorText = await sessionResponse.text();
          throw new AccessTokenError(
            `Laika Backend Error: ${errorText}`,
          );
        }

        const sessionData = await sessionResponse.json();
        const userAttributes = sessionData.data?.attributes || sessionData;

        // Extract user data from session response
        const userData = {
          name: userAttributes.name || userAttributes.email || 'Unknown',
          email: userAttributes.email || '',
          avatar_url: userAttributes.avatar_url || userAttributes.picture,
          metadata: {},
        };

        // Store the access token in session storage for restoreUser
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem(LaikaBackend.SESSION_TOKEN_KEY, token as string);
        }

        // Initialize repositories
        this.assetsRepository = getAssetsRepository({
          tokenPromise: this.tokenPromise,
          baseUrl: this.apiUrl,
        });

        this.documentsRepository = getDocumentsRepository({
          tokenPromise: this.tokenPromise,
          baseUrl: this.apiUrl,
        });

        const authUser = {
          name: userData.name,
          login: userData.email,
          avatar_url: userData.avatar_url,
        } as unknown as User;

        return authUser;
      } catch (error) {
        console.error(error);
        if (error instanceof APIError) {
          throw error;
        }
        throw new APIError(
          `Authentication failed: ${(error as Error).message}`,
          401,
          'Laika Backend',
        );
      }
    }

    async logout() {
      // Clear stored token from session storage
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(LaikaBackend.SESSION_TOKEN_KEY);
      }
      this.tokenPromise = undefined;
      this.assetsRepository = undefined;
      this.documentsRepository = undefined;
      this.entryCache.clear();
      this.unpublishedEntryCache.clear();
      this.unpublishedEntriesListCache.clear();
    }

    getToken() {
      if (!this.tokenPromise) {
        throw new AccessTokenError('Not authenticated');
      }
      return this.tokenPromise();
    }

    /**
     * Get the documents repository
     */
    getDocumentsRepo(): DocumentsRepository {
      if (!this.documentsRepository) {
        throw new AccessTokenError('Not authenticated - documents repository not initialized');
      }
      return this.documentsRepository;
    }

    /**
     * Get the assets repository for media operations
     */
    getAssetsRepo(): AssetsRepository {
      if (!this.assetsRepository) {
        throw new AccessTokenError('Not authenticated - assets repository not initialized');
      }
      return this.assetsRepository;
    }

    // ===== ENTRY OPERATIONS (using DocumentsRepository) =====

    async entriesByFolder(folder: string, extension: string, depth: number): Promise<ImplementationEntry[]> {
      const repo = this.getDocumentsRepo();
      const entries: ImplementationEntry[] = [];

      const pagination: Pagination = { limit: 100, offset: 0 };

      for await (
        const result of repo.listRecords({
          pagination,
          folder,
          type: 'published',
          depth: 10,
        })
      ) {
        if (Result.isFailure(result)) {
          console.error('Error listing records:', result.failure);
          continue;
        }

        if (Result.isSuccess(result)) {
          for (const record of result.success) {
            if (record.type === 'published') {
              const entry: ImplementationEntry = {
                file: { path: record.key, id: record.key },
                data: contentToRawString(record.content),
              };
              entries.push(entry);
              // Pre-populate the entry cache to avoid redundant fetches
              this.entryCache.set(record.key, entry);
            }
          }
        }
      }

      console.log('entries', entries);

      return entries;
    }

    async allEntriesByFolder(
      folder: string,
      extension: string,
      depth: number,
      pathRegex?: RegExp,
    ): Promise<ImplementationEntry[]> {
      const entries = await this.entriesByFolder(folder, extension, depth);

      if (pathRegex) {
        return entries.filter(entry => pathRegex.test(entry.file.path));
      }

      return entries;
    }

    async entriesByFiles(files: ImplementationFile[]): Promise<ImplementationEntry[]> {
      const entries: ImplementationEntry[] = [];

      for (const file of files) {
        try {
          const entry = await this.getEntry(file.path);
          entries.push(entry);
        } catch (error) {
          console.error(`Error getting entry for ${file.path}:`, error);
        }
      }

      return entries;
    }

    async getEntry(path: string): Promise<ImplementationEntry> {
      try {
        const key = normalizeKey(path);

        // Use getOrFetch for request deduplication
        return this.entryCache.getOrFetch(key, async () => {
          const repo = this.getDocumentsRepo();

          const failedResults: LaikaError[] = [];

          const result = await AsyncGenerator.accumulateFirst(
            repo.getDocument(key),
          );

          if (Result.isSuccess(result)) {
            console.log(`Successfully fetched entry for key: ${key}`);
            return {
              file: { path: result.success.key, id: result.success.key },
              data: contentToRawString(result.success.content),
            };
          } else {
            failedResults.push(...result.failure);
          }

          const unpublishedResult = await AsyncGenerator.accumulateFirst(
            repo.getUnpublished(key),
          );

          if (Result.isSuccess(unpublishedResult)) {
            console.log(`Entry ${key} is unpublished, returning unpublished content`);
            return {
              file: { path: unpublishedResult.success.key, id: unpublishedResult.success.key },
              data: contentToRawString(unpublishedResult.success.content),
            };
          } else {
            failedResults.push(...unpublishedResult.failure);
          }

          const errors = failedResults.map(fr => `Code: ${fr.code}, Message: ${fr.message}`).join('; ');
          const status: ErrorCode = failedResults[0]?.code ?? errorCode.INTERNAL_ERROR;

          console.error(`Failed to fetch entry for key: ${key}. Errors: ${errors}`);

          throw new APIError(errors, ErrorCodeToStatusMap[status], 'Laika Backend');
        });
      } catch (error) {
        console.error(error);
        throw error;
      }
    }

    // Update published options:
    // collectionName: "articles"
    // commitMessage : "Update Articles “test2”"
    // newEntry: false
    // status: undefined
    // unpublished: false
    // useWorkflow: true

    // Unpublish options:
    // collectionName: "articles"
    // commitMessage : "Unpublish Articles “test2”"
    // newEntry: false
    // status: "draft"
    // unpublished: true
    // useWorkflow: true
    async persistEntry(entry: Entry, options: PersistOptions): Promise<void> {
      // First, persist any assets (images, files) that are part of this entry
      // These are AssetProxy objects that need to be uploaded before the entry is saved
      if (entry.assets && entry.assets.length > 0) {
        console.log(`Persisting ${entry.assets.length} assets for entry`);
        for (const asset of entry.assets) {
          try {
            await this.persistMedia(asset, options);
            console.log(`Successfully persisted asset: ${asset.path}`);
          } catch (error) {
            console.error(`Failed to persist asset ${asset.path}:`, error);
            throw error;
          }
        }
      }

      const repo = this.getDocumentsRepo();

      // Process ALL data files - important for i18n with multiple_folders structure
      // Each locale gets its own file (e.g., pages/en/index.json, pages/nl/index.json)
      for (const dataFile of entry.dataFiles) {
        const content = typeof dataFile.raw === 'string'
          ? JSON.parse(dataFile.raw)
          : dataFile.raw || {};

        const entryKey = normalizeKey(dataFile.path);

        console.log(`Persisting data file: ${entryKey}`);

        if (options.useWorkflow && typeof options.status === 'string' && options.status !== 'published') {
          const newEntry = options.newEntry || options.unpublished === false;
          if (newEntry) {
            console.log('I dont know what language to use', { dataFile })
            const result = repo.createUnpublished({
              type: 'unpublished',
              status: options.status || 'draft',
              key: entryKey,
              language: content.language ?? 'unk',
              content,
            });
            for await (const element of result) {
              if (Result.isFailure(element)) {
                throw new APIError(
                  `Failed to persist new unpublished entry: ${element.failure.message}`,
                  ErrorCodeToStatusMap[element.failure.code as ErrorCode],
                  'Laika Backend',
                );
              }
            }
          } else {
            const result = await repo.updateUnpublished({
              key: entryKey,
              content,
              status: options.status,
            });
            for await (const element of result) {
              if (Result.isFailure(element)) {
                throw new APIError(
                  `Failed to update unpublished entry: ${element.failure.message}`,
                  ErrorCodeToStatusMap[element.failure.code as ErrorCode],
                  'Laika Backend',
                );
              }
            }
          }
        } else {
          // Published document
          console.log('I dont know what language to use', { dataFile })

          if (options.newEntry) {
            const result = await repo.createDocument({
              type: 'published',
              status: 'published',
              key: entryKey,
              language: content.language ?? 'unk',
              content,
            });
            for await (const element of result) {
              if (Result.isFailure(element)) {
                throw new APIError(
                  `Failed to persist new entry: ${element.failure.message}`,
                  ErrorCodeToStatusMap[element.failure.code as ErrorCode],
                  'Laika Backend',
                );
              }
            }
          } else {
            const result = await repo.updateDocument({
              key: entryKey,
              content,
            });
            for await (const element of result) {
              if (Result.isFailure(element)) {
                throw new APIError(
                  `Failed to update entry: ${element.failure.message}`,
                  ErrorCodeToStatusMap[element.failure.code as ErrorCode],
                  'Laika Backend',
                );
              }
            }
          }
        }
      }

      // Invalidate caches for all persisted entries
      for (const dataFile of entry.dataFiles) {
        const entryKey = normalizeKey(dataFile.path);
        this.entryCache.invalidate(entryKey);
        this.unpublishedEntryCache.invalidate(entryKey);
      }
      this.unpublishedEntriesListCache.clear();
    }

    async deleteFiles(paths: string[], commitMessage: string): Promise<void> {
      const repo = this.getDocumentsRepo();

      for (const path of paths) {
        const key = normalizeKey(path);
        // Try to delete as document first
        const docResult = repo.deleteDocument(key);
        let deleted = false;
        for await (const element of docResult) {
          if (Result.isSuccess(element)) {
            console.log(`Deleted published document: ${path}`);
            deleted = true;
            continue;
          }
        }
        if (!deleted) {
          // Try to delete as unpublished
          const unpublishedResult = repo.deleteUnpublished(key);
          for await (const element of unpublishedResult) {
            if (Result.isSuccess(element)) {
              console.error(`Failed to delete ${path}:`, element.success);
            }
          }
        }
      }
    }

    // ===== MEDIA OPERATIONS (using AssetsRepository) =====

    /**
     * Construct the public path for a media file
     * This is the path that will be used in content and for lookups
     */
    private getPublicPath(filename: string): string {
      const name = filename.split('/').pop() || filename;
      const publicFolder = this.publicFolder;

      // Handle special cases for public folder
      if (!publicFolder || publicFolder === '.' || publicFolder === '') {
        return name;
      }

      // Join public folder with filename
      return `${publicFolder.replace(/\/$/, '')}/${name}`;
    }

    async getMedia(mediaFolder = this.mediaFolder): Promise<ImplementationMediaFile[]> {
      const repo = this.getAssetsRepo();
      const media: ImplementationMediaFile[] = [];

      const pagination: Pagination = { limit: 100, offset: 0 };

      for await (
        const result of repo.listResources('', {
          depth: Infinity,
          pagination,
          hints: { urls: true },
        })
      ) {
        if (Result.isFailure(result)) {
          console.error('Error listing media:', result);
          continue;
        } else if (Result.isSuccess(result)) {
          for (const resource of result.success) {
            if (resource.type === 'asset') {
              // Get the URL for display - use repository method
              for await (const urlsResult of repo.getUrls([resource])) {
                console.log('urlsResult', urlsResult);
                if (Result.isFailure(urlsResult)) {
                  throw new APIError(
                    `Failed to get media URLs: ${urlsResult.failure.message}`,
                    ErrorCodeToStatusMap[urlsResult.failure.code as ErrorCode],
                    'Laika Backend',
                  );
                }
                for (const urlData of urlsResult.success) {
                  const displayUrl = urlData.url;

                  if (!displayUrl) {
                    throw new APIError(`No URL available for asset: ${resource.key}`, 500, 'Laika Backend');
                  }

                  // Use public path for the path property so it matches what's in content
                  const publicPath = this.getPublicPath(resource.key);

                  media.push({
                    id: resource.key,
                    name: resource.key.split('/').pop() || resource.key,
                    size: (resource.content as { size?: number })?.size || 0,
                    displayURL: displayUrl,
                    path: publicPath,
                    url: displayUrl,
                  });
                }
              }
            }
          }
        }
      }

      console.log('media', media);

      return media;
    }

    async getMediaDisplayURL(displayURL: DisplayURL): Promise<string> {
      console.log('getMediaDisplayURL', displayURL);
      if (typeof displayURL === 'string') {
        return displayURL;
      }

      const { id, path } = displayURL as { id: string, path: string };

      const mediaFile = await this.getMediaFile(path);
      return mediaFile.url;
    }

    /**
     * Extract the storage key from a public path
     * If public_folder is "assets/uploads" and path is "assets/uploads/x.jpg",
     * the storage key is "x.jpg"
     */
    private getStorageKey(publicPath: string): string {
      const publicFolder = this.publicFolder;

      // If no public folder or it's "." or empty, the path is the key
      if (!publicFolder || publicFolder === '.' || publicFolder === '') {
        return publicPath;
      }

      // Remove the public folder prefix if present
      const prefix = publicFolder.replace(/\/$/, '') + '/';
      if (publicPath.startsWith(prefix)) {
        return publicPath.slice(prefix.length);
      }

      // If the path doesn't start with the prefix, it might already be a storage key
      return publicPath;
    }

    async getMediaFile(path: string): Promise<ImplementationMediaFile & { file: File, url: string }> {
      try {
        const repo = this.getAssetsRepo();

        // Convert public path to storage key
        const storageKey = this.getStorageKey(path);

        const asset = Result.getOrThrow(await AsyncGenerator.accumulateFirst(repo.getAsset(storageKey)));
        const [{ metadata }] = Result.getOrThrow(await AsyncGenerator.accumulateFirst(repo.getMetadata([asset])));
        const [{ url }] = Result.getOrThrow(await AsyncGenerator.accumulateFirst(repo.getUrls([asset])));

        if (!url) {
          throw new APIError(`No URL available for asset: ${asset.key}`, 500, 'Laika Backend');
        }

        const name = path.split('/').pop() || path;

        const mimeType = metadata.mimeType || 'application/octet-stream';

        // Create a File object - for now we create an empty file since we don't have the binary content
        // The URL should be used to fetch the actual content
        const blob = new Blob([], { type: mimeType });
        const file = new File([blob], name, { type: mimeType });

        // Use public path for the path property so it matches what's in content
        const publicPath = this.getPublicPath(asset.key);

        const actualFile = {
          id: asset.key,
          name,
          size: (asset.content as { size?: number })?.size || 0,
          displayURL: url,
          path: publicPath,
          file,
          url,
        };

        console.log('getMediaFile()', actualFile);

        return actualFile;
      } catch (error) {
        console.error(`Error getting media file for path ${path}:`, error);

        throw new APIError(
          `Failed to get media file for path ${path}: ${(error as Error).message}`,
          500,
          'Laika Backend',
        );
      }
    }

    async persistMedia(mediaFile: AssetProxy, options: PersistOptions): Promise<ImplementationMediaFile> {
      const repo = this.getAssetsRepo();

      // Read the file content
      const fileBlob = mediaFile.fileObj;

      if (!fileBlob) {
        throw new APIError('No file content provided', 400, 'Laika Backend');
      }

      // mediaFile.path comes from Decap CMS and may include the public folder prefix
      // We need to extract just the filename for storage
      const incomingPath = mediaFile.path;
      const originalFilename = fileBlob.name;

      // Extract just the filename from the path for storage
      // The path might be "assets/uploads/x.jpg" but we store as "x.jpg"
      let storageKey = incomingPath.split('/').pop() || incomingPath;

      // If the key doesn't have an extension, add one based on MIME type
      if (!storageKey.includes('.') && fileBlob.type) {
        const ext = this.getExtensionFromMimeType(fileBlob.type);
        if (ext) {
          storageKey = `${storageKey}.${ext}`;
        }
      }

      // Convert file to Uint8Array for AssetCreate
      const arrayBuffer = await fileBlob.arrayBuffer();
      const content = new Uint8Array(arrayBuffer);

      const createData: AssetCreate = {
        key: storageKey,
        content,
        mimeType: fileBlob.type || 'application/octet-stream',
        filename: originalFilename,
      };

      const newAsset = Result.getOrThrowWith(
        await AsyncGenerator.accumulateFirst(repo.createAsset(createData)),
        ([error]) =>
          new APIError(
            `Failed to persist media: ${error.message}`,
            ErrorCodeToStatusMap[error.code as ErrorCode],
            'Laika Backend',
          ),
      );

      const [urlResult] = Result.getOrThrowWith(
        await AsyncGenerator.accumulateFirst(repo.getUrls([newAsset])),
        ([error]) =>
          new APIError(
            `Failed to get media URL: ${error.message}`,
            ErrorCodeToStatusMap[error.code as ErrorCode],
            'Laika Backend',
          ),
      );

      if (!urlResult.url) {
        throw new APIError(`No URL available for newly created asset: ${newAsset.key}`, 500, 'Laika Backend');
      }

      // Use public path for the path property so it matches what's in content
      const publicPath = this.getPublicPath(newAsset.key);
      const name = newAsset.key.split('/').pop() || newAsset.key;

      const persistedFile: ImplementationMediaFile = {
        id: newAsset.key,
        name: name,
        size: fileBlob.size,
        displayURL: urlResult.url,
        path: publicPath,
        url: urlResult.url,
        file: fileBlob,
      };

      return persistedFile;
    }

    async unpublishedEntries(): Promise<string[]> {
      // Use cache with a fixed key since this returns all unpublished entries
      return this.unpublishedEntriesListCache.getOrFetch('all', async () => {
        // Get all collections from config and list unpublished entries
        const collections = (this.config as unknown as { collections?: Array<{ name: string } | string> }).collections
          || [];
        const entries: string[] = [];
        const repo = this.getDocumentsRepo();

        for (const collection of collections) {
          const collectionName = typeof collection === 'string' ? collection : collection.name;

          const pagination: Pagination = { limit: 100, offset: 0 };

          for await (
            const result of repo.listRecords({
              pagination,
              folder: collectionName,
              type: 'unpublished',
              depth: 10,
            })
          ) {
            if (Result.isFailure(result)) {
              console.error(`Error listing unpublished for ${collectionName}:`, result.failure);
              continue;
            }

            for (const unpub of result.success) {
              if (unpub.type !== 'unpublished') {
                throw new IllegalStateException(`Expected unpublished type but got ${unpub.type}`);
              }

              entries.push(unpub.key);

              // Pre-populate the unpublished entry cache to avoid redundant fetches
              const keyParts = unpub.key.split('/');
              const resolvedCollection = keyParts[0];
              const resolvedSlug = keyParts.slice(1).join('/') || keyParts[keyParts.length - 1];

              const unpublishedEntry: UnpublishedEntry = {
                collection: resolvedCollection,
                slug: resolvedSlug,
                status: unpub.status,
                // Empty diffs - Decap CMS will fetch data via unpublishedEntryDataFile
                // Including data files in diffs causes Decap to treat them as media files
                diffs: [],
                updatedAt: unpub.updatedAt || new Date().toISOString(),
              };
              this.unpublishedEntryCache.set(unpub.key, unpublishedEntry);

              // Also pre-populate the entry cache with the content
              const entry: ImplementationEntry = {
                file: { path: unpub.key, id: unpub.key },
                data: contentToRawString(unpub.content),
              };
              this.entryCache.set(unpub.key, entry);
            }
          }
        }

        return entries;
      });
    }

    async unpublishedEntry({
      id,
      collection,
      slug,
    }: {
      id?: string,
      collection?: string,
      slug?: string,
    }): Promise<UnpublishedEntry> {
      // Determine the key - id takes precedence, then construct from collection/slug
      // Normalize to remove file extensions
      let key: string;
      if (id) {
        key = normalizeKey(id);
      } else if (collection && slug) {
        key = normalizeKey(`${collection}/${slug}`);
      } else {
        throw new APIError(
          'Either id or both collection and slug are required to get unpublished entry',
          ErrorCodeToStatusMap[errorCode.BAD_REQUEST],
          'Laika Backend',
        );
      }

      // Use getOrFetch for request deduplication
      return this.unpublishedEntryCache.getOrFetch(key, async () => {
        const repo = this.getDocumentsRepo();
        const unpub = Result.getOrThrowWith(
          await AsyncGenerator.accumulateFirst(repo.getUnpublished(key)),
          ([error]) =>
            new APIError(
              `Failed to get unpublished entry: ${error.message}`,
              ErrorCodeToStatusMap[error.code as ErrorCode],
              'Laika Backend',
            ),
        );

        // Extract collection and slug from the key if not provided
        // Key format is typically "collection/slug" or "collection/path/to/slug"
        const keyParts = unpub.key.split('/');
        const resolvedCollection = collection || keyParts[0];
        const resolvedSlug = slug ? normalizeKey(slug) : keyParts.slice(1).join('/') || keyParts[keyParts.length - 1];

        // Empty diffs - Decap CMS will fetch data via unpublishedEntryDataFile
        // Including data files in diffs causes Decap to treat them as media files
        return {
          collection: resolvedCollection,
          slug: resolvedSlug,
          status: unpub.status,
          diffs: [],
          updatedAt: unpub.updatedAt || new Date().toISOString(),
        };
      });
    }

    async unpublishedEntryDataFile(
      collection: string,
      slug: string,
      path: string,
      id: string,
    ): Promise<string> {
      const repo = this.getDocumentsRepo();
      // Normalize all possible key sources
      const key = normalizeKey(id || path || `${collection}/${slug}`);

      const result = Result.getOrThrowWith(
        await AsyncGenerator.accumulateFirst(repo.getUnpublished(key)),
        ([error]) =>
          new APIError(
            `Failed to get unpublished entry data: ${error.message}`,
            ErrorCodeToStatusMap[error.code as ErrorCode],
            'Laika Backend',
          ),
      );

      return contentToRawString(result.content);
    }

    async unpublishedEntryMediaFile(
      collection: string,
      slug: string,
      path: string,
      id: string,
    ): Promise<ImplementationMediaFile & { file: File }> {
      // Media files for unpublished entries are stored in storage
      return this.getMediaFile(path);
    }

    async updateUnpublishedEntryStatus(
      collection: string,
      slug: string,
      newStatus: string,
    ): Promise<void> {
      const repo = this.getDocumentsRepo();
      const key = normalizeKey(`${collection}/${slug}`);

      Result.getOrThrowWith(
        await AsyncGenerator.accumulateFirst(repo.updateUnpublished({ key, status: newStatus })),
        ([error]) =>
          new APIError(
            `Failed to update status: ${error.message}`,
            ErrorCodeToStatusMap[error.code as ErrorCode],
            'Laika Backend',
          ),
      );
    }

    async deleteUnpublishedEntry(collection: string, slug: string): Promise<void> {
      const repo = this.getDocumentsRepo();
      const key = normalizeKey(`${collection}/${slug}`);

      const result = await repo.deleteUnpublished(key);

      Result.getOrThrowWith(
        await AsyncGenerator.accumulateFirst(repo.deleteUnpublished(key)),
        ([error]) =>
          new APIError(
            `Failed to delete unpublished entry: ${error.message}`,
            ErrorCodeToStatusMap[error.code as ErrorCode],
            'Laika Backend',
          ),
      );
    }

    async publishUnpublishedEntry(collection: string, slug: string): Promise<void> {
      const repo = this.getDocumentsRepo();
      const key = normalizeKey(`${collection}/${slug}`);

      const result = await repo.publish(key);

      Result.getOrThrowWith(
        await AsyncGenerator.accumulateFirst(repo.publish(key)),
        ([error]) =>
          new APIError(
            `Failed to publish entry: ${error.message}`,
            ErrorCodeToStatusMap[error.code as ErrorCode],
            'Laika Backend',
          ),
      );
    }

    // ===== CURSOR/PAGINATION =====

    async traverseCursor(cursor: Cursor, action: string): Promise<{
      entries: ImplementationEntry[],
      cursor: Cursor,
    }> {
      // Basic cursor implementation - can be enhanced based on needs
      const data = cursor.data?.toJS?.() || {};
      const folder = data.folder as string;

      const entries = await this.entriesByFolder(folder, '', 1);

      return {
        entries,
        cursor,
      };
    }

    // ===== DEPLOY PREVIEW =====

    async getDeployPreview(collection: string, slug: string): Promise<{ url: string, status: string } | null> {
      // Deploy preview is not supported in this implementation
      return null;
    }
  };
}
