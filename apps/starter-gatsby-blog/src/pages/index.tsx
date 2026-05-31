import { graphql, type HeadFC, type PageProps } from 'gatsby';

type PostNode = {
  slug: string,
  title: string,
  date?: string,
};

type IndexData = {
  allLaikaPost: { nodes: PostNode[] },
};

/**
 * Gatsby page query — runs at build time. Data is embedded in the page HTML.
 * Components never call laika.documents.* directly at runtime.
 *
 * Doc gap: In Gatsby, ALL data fetching happens at build time via GraphQL.
 * Runtime data loading (laika.documents.* in a route handler) doesn't apply
 * here — that pattern is only used in Gatsby Functions for the Decap proxy.
 */
export const query = graphql`
  query IndexPosts {
    allLaikaPost(sort: { date: DESC }) {
      nodes {
        slug
        title
        date
      }
    }
  }
`;

export const Head: HeadFC = () => <title>Blog</title>;

export default function IndexPage({ data }: PageProps<IndexData>) {
  const posts = data.allLaikaPost.nodes;

  return (
    <main>
      <h1>Blog</h1>
      {posts.length === 0
        ? (
          <p>
            No posts yet. <a href="/admin">Open the CMS</a> to write your first post.
          </p>
        )
        : (
          <ul>
            {posts.map(post => (
              <li key={post.slug}>
                <a href={`/blog/${post.slug}`}>{post.title}</a>
                {post.date && (
                  <>
                    {' · '}
                    <time>{new Date(post.date).toLocaleDateString()}</time>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      <p>
        <a href="/admin">Edit in CMS →</a>
      </p>
    </main>
  );
}
