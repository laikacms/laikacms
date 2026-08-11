/**
 * Merge the per-API OpenAPI documents laikacms generates into one contract.
 *
 * Each Laika CMS JSON:API (documents, storage, assets, catalog) authors its own
 * self-contained OpenAPI 3.1 document rooted at its own base path. A composed
 * server like `laikaApi` mounts them side by side (`{base}/documents`,
 * `{base}/storage`, …), so the MCP `read_api_spec` tool needs a single document
 * whose path keys match what `api_request` can actually reach.
 *
 * The merge is mechanical and collision-free by construction:
 *
 *  - path keys are prefixed with the mount segment (`/records` under mount
 *    `documents` becomes `/documents/records`);
 *  - tags are namespaced per mount (`published` -> `documents/published`) so
 *    the spec index groups operations by API;
 *  - every component is renamed with the PascalCased mount (`JsonApiError` ->
 *    `DocumentsJsonApiError`) and all `$ref`s are rewritten to match. Shared
 *    components are duplicated per source rather than deduplicated - slices
 *    only carry the `$ref` closure they need, so the duplication never reaches
 *    a model's context.
 */
import { buildAssetsOpenApi } from 'laikacms/assets/api';
import { buildDocumentsOpenApi } from 'laikacms/documents/api';
import type { OpenApiDocument } from 'laikacms/json-api';
import { buildStorageOpenApi } from 'laikacms/storage/api';

/** One API to fold into the combined document. */
export interface OpenApiSource {
  /**
   * Mount segment under the combined base path, without slashes — `'documents'`
   * turns the source's `/records` into `/documents/records`.
   */
  mount: string;
  /** The API's own OpenAPI document (its `servers` entry is discarded). */
  document: OpenApiDocument;
}

export interface CombineOpenApiOptions {
  /** `info` of the combined document. Defaults to a generic Laika CMS API title. */
  info?: OpenApiDocument['info'] | undefined;
  /**
   * Base path all sources are mounted under — becomes `servers[0].url`. Must
   * match the `basePath` the composed server was built with. Defaults to `''`
   * (the origin root, served as `/`).
   */
  basePath?: string | undefined;
  sources: OpenApiSource[];
}

interface SpecRecord {
  [key: string]: unknown;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const pascalCase = (segment: string): string =>
  segment
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');

/** Rewrite every `#/components/<section>/<name>` pointer to its prefixed name, in place. */
function prefixRefs(value: unknown, prefix: string): void {
  if (Array.isArray(value)) {
    for (const entry of value) prefixRefs(entry, prefix);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const record = value as SpecRecord;
  for (const [key, entry] of Object.entries(record)) {
    if (key === '$ref' && typeof entry === 'string' && entry.startsWith('#/components/')) {
      const [, , section, ...rest] = entry.split('/');
      record[key] = `#/components/${section}/${prefix}${rest.join('/')}`;
      continue;
    }
    prefixRefs(entry, prefix);
  }
}

const HTTP_METHODS = ['get', 'put', 'post', 'patch', 'delete', 'head', 'options', 'trace'] as const;

/**
 * Combine several per-API OpenAPI documents into one, remounting each source
 * under its `mount` segment. The result is a valid, self-contained document
 * ready for the `read_api_spec` slicer.
 */
export function combineOpenApiDocuments(options: CombineOpenApiOptions): OpenApiDocument {
  const basePath = options.basePath ?? '';
  const paths: Record<string, SpecRecord> = {};
  const components: Record<string, Record<string, unknown>> = {};
  const tags: { name: string, description?: string }[] = [];

  for (const { mount, document } of options.sources) {
    const segment = mount.replace(/^\/+|\/+$/g, '');
    if (segment === '') throw new Error(`combineOpenApiDocuments: empty mount segment for "${document.info.title}"`);
    const prefix = pascalCase(segment);
    // The builders share helper-produced objects across documents, so work on
    // a copy before rewriting refs/tags in place (plain JSON data by the same
    // assumption compactOpenApiDocument makes).
    const source = clone(document) as unknown as {
      tags?: { name?: string, description?: string }[],
      paths: Record<string, SpecRecord>,
      components?: Record<string, Record<string, unknown>>,
    };
    prefixRefs(source.paths, prefix);
    prefixRefs(source.components ?? {}, prefix);

    for (const tag of source.tags ?? []) {
      if (tag.name) {
        tags.push({ name: `${segment}/${tag.name}`, ...(tag.description ? { description: tag.description } : {}) });
      }
    }

    for (const [path, item] of Object.entries(source.paths)) {
      for (const method of HTTP_METHODS) {
        const operation = item[method] as SpecRecord | undefined;
        if (operation && Array.isArray(operation.tags)) {
          operation.tags = operation.tags.map(tag => `${segment}/${String(tag)}`);
        }
      }
      paths[path === '/' ? `/${segment}` : `/${segment}${path}`] = item;
    }

    for (const [section, entries] of Object.entries(source.components ?? {})) {
      const target = components[section] ??= {};
      for (const [name, definition] of Object.entries(entries)) {
        target[`${prefix}${name}`] = definition;
      }
    }
  }

  return {
    openapi: '3.1.0',
    info: options.info ?? {
      title: 'Laika CMS API',
      version: '1.0.0',
      description: `Combined contract for the mounted Laika CMS JSON:APIs: ${
        options.sources.map(source => source.mount).join(', ')
      }.`,
    },
    servers: [{ url: basePath === '' ? '/' : basePath }],
    tags,
    paths: paths as OpenApiDocument['paths'],
    components: components as OpenApiDocument['components'],
  };
}

export interface LaikaApiOpenApiOptions {
  /** The `basePath` the `laikaApi` server was built with. Defaults to `''`. */
  basePath?: string | undefined;
  /** Include the assets API. Match the presence of `assets` in `LaikaApiOptions`. Defaults to true. */
  assets?: boolean | undefined;
}

/**
 * The combined OpenAPI document for a `laikaApi` deployment: the documents,
 * storage and (optionally) assets APIs under their `laikaApi` mount segments.
 *
 * The `/session` and `/locks` endpoints have no generated OpenAPI description
 * yet and are absent. A catalog API mounted next to `laikaApi` can be added
 * via {@link combineOpenApiDocuments} with `buildCatalogOpenApi` from
 * `laikacms/catalog-api` as an extra source.
 */
export function buildLaikaApiOpenApi(options: LaikaApiOpenApiOptions = {}): OpenApiDocument {
  const { basePath = '', assets = true } = options;
  return combineOpenApiDocuments({
    basePath,
    info: {
      title: 'Laika CMS API',
      version: '1.0.0',
      description: 'JSON:API surface of a Laika CMS deployment: documents (published/unpublished records, revisions, '
        + 'state transitions), raw storage objects and folders'
        + (assets ? ', and binary assets' : '')
        + '. Every request is authenticated and authorized by the server this document describes.',
    },
    sources: [
      { mount: 'documents', document: buildDocumentsOpenApi() },
      { mount: 'storage', document: buildStorageOpenApi() },
      ...(assets ? [{ mount: 'assets', document: buildAssetsOpenApi() }] : []),
    ],
  });
}
