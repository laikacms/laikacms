import { type PageProps } from '$fresh/server.ts';

export default function NotFoundPage({ url }: PageProps) {
  return (
    <main>
      <h1>404 — Not Found</h1>
      <p>
        <code>{url.pathname}</code> does not exist.
      </p>
      <p>
        <a href="/">← Back to blog</a>
      </p>
    </main>
  );
}
