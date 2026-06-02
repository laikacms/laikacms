import type { GetServerSideProps } from 'next';

import { runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { laika } from '@/lib/laika';

interface Post {
  title: string;
  body: string;
  date: string | null;
}

interface PostProps {
  post: Post;
}

export const getServerSideProps: GetServerSideProps<PostProps> = async ({ params }) => {
  const slug = params?.slug as string;
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    const content = ((doc as { content?: Record<string, unknown> }).content ?? {}) as Record<
      string,
      unknown
    >;
    return {
      props: {
        post: {
          title: (content.title as string) ?? slug,
          body: (content.body as string) ?? '',
          date: (content.date as string) ?? null,
        },
      },
    };
  } catch (err) {
    if (err instanceof NotFoundError) return { notFound: true };
    throw err;
  }
};

export default function PostPage({ post }: PostProps) {
  return (
    <article>
      <h2 style={{ marginBottom: '0.25rem' }}>{post.title}</h2>
      {post.date && <small style={{ color: '#666' }}>{new Date(post.date).toLocaleDateString()}</small>}
      <div style={{ marginTop: '1.5rem', whiteSpace: 'pre-wrap' }}>{post.body}</div>
    </article>
  );
}
