/**
 * JSON:API Proxy implementation for Documents
 *
 * This package provides a proxy implementation of the DocumentsRepository
 * that communicates with packages/apis/documents-api over HTTP using JSON:API.
 * This enables microservice architecture by decoupling the documents implementation
 * from the client code.
 */

export { DocumentsJsonApiProxyRepository } from './documents-jsonapi-proxy-repository.js';
export { paginationCodec } from './pagination-codec.js';
