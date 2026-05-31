import type { GetServerSideProps } from 'next';
import Link from 'next/link';

import { collectStream } from 'laikacms/compat';

import { laika } from '@/lib/laika';

interface PostListItem {
  slug: string;
  title: string;
  date: string | null;
}

interface HomeProps {
  posts: PostListItem[];
}

// Pages Router uses getServerSideProps for SSR. Compare with the App Router
// variant (cloud routine's `starter-next-blog`) which uses async server
// components instead.
export const getServerSideProps: GetServerSideProps<HomeProps> = async () => {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );
  const posts: PostListItem[] = items
    .filter(item => item.type === 'published')
    .map(item => {
      const content = ((item as { content?: Record<string, unknown> }).content ?? {}) as Record<
        string,
        unknown
      >;
      const slug = (item as { key: string }).key.replace(/^posts\//, '').replace(/\.md$/, '');
      return {
        slug,
        title: (content.title as string) ?? slug,
        date: (content.date as string) ?? null,
      };
    });
  return { props: { posts } };
};

export default function Home({ posts }: HomeProps) {
  return (
    <section>
      <p>
        Edit posts at <Link href="/admin">/admin</Link> (Decap CMS). Content is stored on disk under{' '}
        <code>./content/posts/</code>.
      </p>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {posts.length === 0 && (
          <li>
            <em>No posts yet — add one in the admin UI.</em>
          </li>
        )}
        {posts.map(post => (
          <li key={post.slug} style={{ marginBottom: '1rem' }}>
            <Link href={`/posts/${post.slug}`}>{post.title}</Link>
            {post.date && (
              <small style={{ marginLeft: '0.5rem', color: '#666' }}>
                {new Date(post.date).toLocaleDateString()}
              </small>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
