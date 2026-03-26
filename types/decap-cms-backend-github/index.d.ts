import GitHubBackend from './src/implementation';
import API from './src/API';
import AuthenticationPage from './src/AuthenticationPage';

// Re-export selected types so consumers don't need to deep-import into /src, which
// would cause TypeScript to follow source files (and effectively "type check" them).
// This keeps builds confined to declaration surfaces.
export type { Config, Diff } from './src/API';

export declare const DecapCmsBackendGithub: {
    GitHubBackend: typeof GitHubBackend;
    API: typeof API;
    AuthenticationPage: typeof AuthenticationPage;
};
export { GitHubBackend, API, AuthenticationPage };
