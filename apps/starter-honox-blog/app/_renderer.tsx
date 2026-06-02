import { jsxRenderer } from 'hono/jsx-renderer';

// Augment ContextRenderer so c.render(<JSX/>, { title }) type-checks.
declare module 'hono' {
  interface ContextRenderer {
    (content: string | Promise<string>, props?: { title?: string }): Response;
  }
}

export default jsxRenderer(({ children, title }: { children?: unknown, title?: string }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title ?? 'My Blog'}</title>
      <style>
        {`
        body { font-family: system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }
        a { color: #0070f3; }
        nav { margin-bottom: 2rem; }
      `}
      </style>
    </head>
    <body>
      <nav>
        <a href="/">Blog</a>
        {' · '}
        <a href="/admin/">Admin</a>
      </nav>
      {children}
    </body>
  </html>
));
