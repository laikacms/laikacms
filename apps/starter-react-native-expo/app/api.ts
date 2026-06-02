// Point this at any deployed LaikaCMS backend with public `/posts*` routes —
// e.g. `apps/starter-hono-backend`, `apps/starter-workers-r2`, or the
// AWS-Lambda cloud-routine variant. The backend must expose unauthenticated
// /posts endpoints (see those starters for the canonical sidecar pattern).
//
// For local dev against a server on your machine, replace localhost with
// your LAN IP — phones and simulators can't see the host's loopback.
export const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? 'http://192.168.1.1:3000';

export interface PostSummary {
  key: string;
  slug: string;
  title: string | null;
}

export interface Post {
  title: string;
  body: string;
  date: string | null;
}

export async function fetchPosts(): Promise<PostSummary[]> {
  const res = await fetch(`${API_BASE}/posts`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as {
    posts: Array<{ key: string, content?: Record<string, unknown> }>,
  };
  return body.posts.map(p => ({
    key: p.key,
    slug: p.key.replace(/^posts\//, '').replace(/\.md$/, ''),
    title: (p.content?.title as string) ?? null,
  }));
}

export async function fetchPost(slug: string): Promise<Post | null> {
  const res = await fetch(`${API_BASE}/posts/${encodeURIComponent(slug)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { post: { content?: Record<string, unknown> } };
  const content = (body.post.content ?? {}) as Record<string, unknown>;
  return {
    title: (content.title as string) ?? slug,
    body: (content.body as string) ?? '',
    date: (content.date as string) ?? null,
  };
}
