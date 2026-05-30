import PKCEAuthenticationPage from './AuthenticationPage';
import DevAuthenticationPage from './DevAuthenticationPage';
import createLaikaBackend from './laika-backend';

// Re-export types separately to avoid runtime re-export warnings (interface erased at compile time)
export type { PKCEAuthPageProps } from './AuthenticationPage';
export type { DevAuthPageProps } from './DevAuthenticationPage';
export type {
  CreateLaikaBackendOptions,
  GetAssetsRepositoryOptions,
  GetDocumentsRepositoryOptions,
  LaikaBackendConfig,
} from './laika-backend';

// Laika CMS backend with dependency injection
export const DecapCmsBackendLaika: {
  createLaikaBackend: typeof createLaikaBackend,
  PKCEAuthenticationPage: typeof PKCEAuthenticationPage,
  DevAuthenticationPage: typeof DevAuthenticationPage,
} = {
  createLaikaBackend,
  PKCEAuthenticationPage,
  DevAuthenticationPage,
};

// Named exports
export { createLaikaBackend, DevAuthenticationPage, PKCEAuthenticationPage };
// Default export
export default createLaikaBackend;
