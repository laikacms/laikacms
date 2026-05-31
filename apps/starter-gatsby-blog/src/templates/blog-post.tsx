import { graphql, type HeadFC, type HeadProps, type PageProps } from 'gatsby';
import * as React from 'react';

type PostData = {
  laikaPost: {
    title: string,
    date?: string,
    description?: string,
    body?: string,
  } | null,
};

export const query = graphql`
  query BlogPost($slug: String!) {
    laikaPost(slug: { eq: $slug }) {
      title
      date
      description
      body
    }
  }
`;

export const Head: HeadFC<PostData, { slug: string }> = ({
  data,
  pageContext,
}: HeadProps<PostData, { slug: string }>) => <title>{data.laikaPost?.title ?? pageContext.slug}</title>;

export default function BlogPostTemplate({ data, pageContext }: PageProps<PostData, { slug: string }>) {
  const post = data.laikaPost;

  if (!post) {
    return (
      <main>
        <p>
          Post not found. <a href="/">← Back</a>
        </p>
      </main>
    );
  }

  return (
    <main>
      <article>
        <h1>{post.title}</h1>
        {post.date && <time>{new Date(post.date).toLocaleDateString()}</time>}
        {post.description && (
          <p>
            <em>{post.description}</em>
          </p>
        )}
        {/* body is raw markdown; pipe through remark/rehype in production */}
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{post.body}</pre>
      </article>
      <p>
        <a href="/">← Back</a>
      </p>
    </main>
  );
}
