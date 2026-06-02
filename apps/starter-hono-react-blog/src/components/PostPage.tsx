import { Layout } from './Layout.js';

export function PostPage({ slug, body }: { slug: string, body: string }) {
  return (
    <Layout title={slug}>
      <article>
        <h1>{slug}</h1>
        {/* body is markdown — display raw; a real app would parse with remark/marked */}
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{body}</pre>
      </article>
      <p>
        <a href="/">← Back</a>
      </p>
    </Layout>
  );
}
