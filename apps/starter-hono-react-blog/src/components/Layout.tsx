export function Layout({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <style>
          {`
          body { font-family: system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }
          a { color: #2563eb; }
          nav { margin-bottom: 2rem; }
        `}
        </style>
      </head>
      <body>
        <nav>
          <a href="/">Home</a> · <a href="/admin/">Admin</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
