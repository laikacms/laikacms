import { runTask } from 'laikacms/compat';
import { data, Link, useLoaderData } from 'react-router';
import { jsx as _jsx, jsxs as _jsxs } from 'react/jsx-runtime';
import { laika } from '~/lib/laika.server';
export async function loader({ params }) {
  const { slug } = params;
  if (!slug) throw data('Not found', { status: 404 });
  let post;
  try {
    post = await runTask(laika.documents.getDocument(`posts/${slug}`));
  } catch {
    throw data('Not found', { status: 404 });
  }
  const { title, date, description, body } = post.content;
  return {
    slug,
    title: title ?? null,
    date: date ?? null,
    description: description ?? null,
    body: body ?? null,
  };
}
export function meta({ data: post }) {
  return [
    { title: post?.title ?? post?.slug ?? 'Post' },
    ...(post?.description ? [{ name: 'description', content: post.description }] : []),
  ];
}
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
