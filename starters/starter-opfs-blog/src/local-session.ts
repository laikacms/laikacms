/**
 * Same-origin fetch shim standing in for the two HTTP endpoints the `laika`
 * Decap backend still expects even in `dev_token` mode: `GET <api>/session`
 * (who is logged in) and `GET <api>/health` (status polling). Everything else
 * the backend does goes through the repositories injected in `src/cms.ts`, so
 * these two stubs are all it takes to run the admin with no server at all.
 *
 * Installed as an import side effect. Import this module FIRST in the admin
 * entry, before anything that pulls in `@laikacms/decap-cms`, so the shim is
 * in place no matter when the backend captures its `fetch` reference.
 */

export const LOCAL_API_BASE = '/__local';
export const LOCAL_DEV_TOKEN = 'laika-local-dev';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function respond(pathname: string): Response {
  switch (pathname) {
    case `${LOCAL_API_BASE}/session`:
      return json({ data: { attributes: { name: 'Local editor', email: 'editor@localhost' } } });
    case `${LOCAL_API_BASE}/health`:
      return json({ status: 'ok' });
    default:
      return new Response('Not found', { status: 404 });
  }
}

const originalFetch = window.fetch.bind(window);

window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
  const url = new URL(raw, window.location.origin);
  if (url.origin === window.location.origin && url.pathname.startsWith(`${LOCAL_API_BASE}/`)) {
    return Promise.resolve(respond(url.pathname));
  }
  return originalFetch(input, init);
};
