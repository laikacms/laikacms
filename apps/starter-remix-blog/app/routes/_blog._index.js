import { json } from '@remix-run/node';
import { Link, useLoaderData } from '@remix-run/react';
import { collectStream } from 'laikacms/compat';
import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from 'react/jsx-runtime';
import { laika } from '~/lib/laika.server';
/**
 * Blog homepage loader — lists published posts using laika.documents.listRecordSummaries
 * via laikacms/compat's collectStream (Promise-friendly, no Effect import needed).
 */
export async function loader(_args) {
  const { items: records } = await collectStream(laika.documents.listRecordSummaries({
    pagination: { page: 1, perPage: 100 },
    folder: 'posts',
    depth: 1,
    type: 'published',
  }));
  const posts = records
    .filter(r => r.type === 'published-summary')
    .map(r => ({
      slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
      updatedAt: r.updatedAt ?? null,
    }))
    .sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      return b.slug.localeCompare(a.slug);
    });
  return json({ posts });
}
export const meta = () => [{ title: 'My Blog' }];
export default function Index() {
  const { posts } = useLoaderData();
  if (posts.length === 0) {
    return (_jsxs('div', {
      children: [
        _jsx('h1', { children: 'My Blog' }),
        _jsxs('p', {
          children: [
            'No posts yet. ',
            _jsx(Link, { to: '/admin', children: 'Open the CMS' }),
            ' to write your first post.',
          ],
        }),
      ],
    }));
  }
  return (_jsxs('div', {
    children: [
      _jsx('h1', { children: 'My Blog' }),
      _jsx('ul', {
        style: { listStyle: 'none', padding: 0 },
        children: posts.map(
          post => (_jsxs('li', {
            style: { marginBottom: '1.5rem' },
            children: [
              _jsx(Link, { to: `/blog/${post.slug}`, children: post.slug }),
              post.updatedAt
              && (_jsxs(_Fragment, {
                children: [' · ', _jsx('time', { children: new Date(post.updatedAt).toLocaleDateString() })],
              })),
            ],
          }, post.slug)),
        ),
      }),
    ],
  }));
}
