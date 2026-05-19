import { createAppAuth } from '@octokit/auth-app';

import type { GitHubAppCreds, GitHubTarget } from './types.js';

const DEFAULT_API_BASE = 'https://api.github.com';
const TOKEN_TTL_BUFFER_MS = 60_000; // refresh 1 minute before GitHub's expiry

/**
 * GitHub App private keys are PEM strings. When passed via env vars they often
 * arrive with literal `\n` sequences and surrounding quotes — normalize those
 * so consumers can paste a raw PEM into `wrangler secret put` without ceremony.
 */
const normalizePrivateKey = (raw: string): string =>
  raw.replace(/\\n/g, '\n').replace(/^"+|"+$/g, '');

/**
 * Mints + caches GitHub App installation tokens. Returns the token (a string)
 * and lazily refreshes when the cached one is about to expire.
 *
 * GitHub installation tokens are valid for one hour; we refresh slightly
 * earlier to absorb clock drift.
 */
export class InstallationTokenSource {
  private readonly auth: ReturnType<typeof createAppAuth>;
  private cached?: { token: string, expiresAt: number };

  constructor(creds: GitHubAppCreds) {
    this.auth = createAppAuth({
      appId: creds.appId,
      privateKey: normalizePrivateKey(creds.privateKey),
      installationId: creds.installationId,
    });
  }

  async getToken(): Promise<string> {
    if (this.cached && Date.now() < this.cached.expiresAt - TOKEN_TTL_BUFFER_MS) {
      return this.cached.token;
    }
    const result = (await this.auth({ type: 'installation' })) as {
      token: string,
      expiresAt: string,
    };
    this.cached = {
      token: result.token,
      expiresAt: Date.parse(result.expiresAt),
    };
    return this.cached.token;
  }
}

/**
 * Returns true when `path` (without the `/github` prefix) targets one of the
 * GitHub REST endpoints Netlify's git-gateway is willing to proxy. Anything
 * else — `/user`, `/orgs`, `/admin` — would broaden the GitHub App's blast
 * radius beyond reading and writing repo content, so we hard-deny.
 */
export const isAllowedGithubPath = (path: string): boolean => {
  const clean = path.startsWith('/') ? path.slice(1) : path;
  const ALLOWED = [
    /^git\//,
    /^contents\//,
    /^pulls(\/|$|\?)/,
    /^branches(\/|$|\?)/,
    /^merges(\/|$|\?)/,
    /^statuses\//,
    /^compare\//,
    /^commits(\/|$|\?)/,
    /^issues\/\d+\/labels$/,
  ];
  return ALLOWED.some(re => re.test(clean));
};

const FORWARDED_REQUEST_HEADERS = new Set([
  'accept',
  'content-type',
  'if-match',
  'if-modified-since',
  'if-none-match',
  'if-unmodified-since',
]);

const FORWARDED_RESPONSE_HEADERS = new Set([
  'content-type',
  'content-length',
  'etag',
  'last-modified',
  'cache-control',
  'expires',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-used',
  'x-ratelimit-resource',
]);

export interface ProxyOptions {
  readonly tokenSource: InstallationTokenSource;
  readonly target: GitHubTarget;
  readonly userAgent: string;
}

/**
 * Proxies a request to GitHub. `subpath` is everything after `/github`
 * (e.g. `/contents/README.md`). Returns the upstream Response, with headers
 * filtered down to a safe forwarding allow-list.
 */
export const proxyToGithub = async (
  request: Request,
  subpath: string,
  options: ProxyOptions,
): Promise<Response> => {
  const apiBase = options.target.apiBase ?? DEFAULT_API_BASE;
  const target = new URL(
    `/repos/${options.target.owner}/${options.target.repo}${subpath}`,
    apiBase,
  );
  // Preserve any query string from the original request.
  const incoming = new URL(request.url);
  incoming.searchParams.forEach((v, k) => target.searchParams.set(k, v));

  const token = await options.tokenSource.getToken();

  const headers = new Headers({
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': options.userAgent,
    'X-GitHub-Api-Version': '2022-11-28',
  });
  request.headers.forEach((value, name) => {
    if (FORWARDED_REQUEST_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  });

  const body = request.method === 'GET' || request.method === 'HEAD'
    ? undefined
    : await request.arrayBuffer();

  const upstream = await fetch(target.toString(), {
    method: request.method,
    headers,
    body,
  });

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, name) => {
    if (FORWARDED_RESPONSE_HEADERS.has(name.toLowerCase())) responseHeaders.set(name, value);
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};
