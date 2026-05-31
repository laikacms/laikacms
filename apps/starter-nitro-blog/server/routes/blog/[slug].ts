import { defineEventHandler, getRouterParam } from 'h3';
import { runTask } from 'laikacms/compat';

import { laika } from '../../utils/laika.js';

type PostContent = {
  title?: string,
  date?: string,
  description?: string,
  body?: string,
};

function page(body: string, title = 'Blog'): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}

export default defineEventHandler(async event => {
  const slug = getRouterParam(event, 'slug') ?? '';
  let post: PostContent;
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    post = doc.content as PostContent;
  } catch {
    return new Response(page('<p>Post not found. <a href="/">← Back</a></p>', '404'), {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  const body = `
    <article>
      <h1>${post.title ?? slug}</h1>
      ${post.date ? `<time>${new Date(post.date).toLocaleDateString()}</time>` : ''}
      ${post.description ? `<p><em>${post.description}</em></p>` : ''}
      <pre style="white-space:pre-wrap;font-family:inherit">${post.body ?? ''}</pre>
    </article>
    <p><a href="/">← Back</a></p>`;

  return new Response(page(body, post.title ?? slug), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
});
