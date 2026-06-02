/**
 * Vite SSR entry point.
 *
 * In dev mode this module is loaded via `vite.ssrLoadModule('/src/entry-server.ts')`.
 * Vite transforms the .svelte imports and compiles them with generate:'server'
 * so `render()` from svelte/server works correctly.
 *
 * In production this module is the --ssr build output in dist/server/.
 *
 * Doc note (ergonomics gap): Svelte 5's render() returns { html, head }.
 * The `head` contains any <svelte:head> content (title, meta, link tags).
 * You must manually splice it into your HTML template — there is no
 * automatic injection unlike SvelteKit's layout system.
 */
import { render } from 'svelte/server';

// These imports are transformed by Vite's Svelte plugin.
// Without Vite (e.g. plain tsx), .svelte files are not importable.
import BlogPage from './components/BlogPage.svelte';
import NotFoundPage from './components/NotFoundPage.svelte';
import PostPage from './components/PostPage.svelte';

export interface PostSummary {
  slug: string;
  title?: string | null;
  updatedAt?: string | null;
}

export interface Post {
  title?: string | null;
  date?: string | null;
  description?: string | null;
  body?: string | null;
}

export function renderBlogPage(posts: PostSummary[]): { html: string, head: string } {
  return render(BlogPage, { props: { posts } });
}

export function renderPostPage(slug: string, post: Post): { html: string, head: string } {
  return render(PostPage, { props: { slug, post } });
}

export function renderNotFoundPage(): { html: string, head: string } {
  return render(NotFoundPage, {});
}
