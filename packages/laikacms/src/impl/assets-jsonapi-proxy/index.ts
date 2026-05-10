/**
 * JSON:API Proxy implementation for Assets
 *
 * This package provides a proxy implementation of the AssetsRepository
 * that communicates with packages/apis/assets-api over HTTP using JSON:API.
 * This enables microservice architecture by decoupling the assets implementation
 * from the client code.
 */

export { AssetsJsonApiProxyRepository } from './assets-jsonapi-proxy-repository.js';
