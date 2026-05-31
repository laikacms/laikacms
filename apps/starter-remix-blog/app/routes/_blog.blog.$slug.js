import { json } from '@remix-run/node';
import { Link, useLoaderData } from '@remix-run/react';
import { runTask } from 'laikacms/compat';
import { jsx as _jsx, jsxs as _jsxs } from 'react/jsx-runtime';
import { laika } from '~/lib/laika.server';
/**
 * Blog post loader — reads a published document via laika.documents.getDocument
 * using runTask from laikacms/compat (Promise-friendly, no Effect import needed).
 *
 * document.content is the parsed frontmatter merged with the body field —
 * the exact fields match what you configured in Decap CMS collections.
 */
export async function loader({ params }) {
  const { slug } = params;
  if (!slug) throw new Response('Not found', { status: 404 });
  let post;
  try {
    post = await runTask(laika.documents.getDocument(`posts/${slug}`));
  } catch {
    throw new Response('Not found', { status: 404 });
  }
  const { title, date, description, body } = post.content;
  return json({
    slug,
    title: title ?? null,
    date: date ?? null,
    description: description ?? null,
    body: body ?? null,
  });
}
export const meta = ({ data }) => [
  { title: data?.title ?? data?.slug ?? 'Post' },
  ...(data?.description ? [{ name: 'description', content: data.description }] : []),
];
export default function BlogPost() {
  const { slug, title, date, description, body } = useLoaderData();
  return (_jsxs('article', {
    children: [
      _jsx('h1', { children: title ?? slug }),
      date && _jsx('time', { children: new Date(date).toLocaleDateString() }),
      description && (_jsx('p', { children: _jsx('em', { children: description }) })),
      _jsx('pre', { style: { whiteSpace: 'pre-wrap', fontFamily: 'inherit' }, children: body }),
      _jsx('p', { children: _jsx(Link, { to: '/', children: '\u2190 Back' }) }),
    ],
  }));
}
