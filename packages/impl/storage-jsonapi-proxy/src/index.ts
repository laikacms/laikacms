/**
 * JSON:API Proxy implementation for Storage
 *
 * This package provides a proxy implementation of the StorageRepository
 * that communicates with packages/apis/storage-api over HTTP using JSON:API.
 * This enables microservice architecture by decoupling the storage implementation
 * from the client code.
 */

export { StorageJsonApiProxyRepository } from './storage-jsonapi-proxy-repository.js';
export { paginationCodec } from './pagination-codec.js';
