import createLaikaBackend from './laika-backend';
import PKCEAuthenticationPage from './AuthenticationPage';

// Re-export types separately to avoid runtime re-export warnings (interface erased at compile time)
export type { PKCEAuthPageProps } from './AuthenticationPage';
export type {
  LaikaBackendConfig,
  CreateLaikaBackendOptions,
  GetDocumentsRepositoryOptions,
  GetAssetsRepositoryOptions,
} from './laika-backend';

// Laika CMS backend with dependency injection
export const DecapCmsBackendLaika: {
  createLaikaBackend: typeof createLaikaBackend;
  PKCEAuthenticationPage: typeof PKCEAuthenticationPage;
} = {
  createLaikaBackend,
  PKCEAuthenticationPage: PKCEAuthenticationPage,
};

// Named exports
export { createLaikaBackend, PKCEAuthenticationPage as PKCEAuthenticationPage };
// Default export
export default createLaikaBackend;
