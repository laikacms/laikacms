import { type AppProps } from '$fresh/server.ts';

export default function App({ Component }: AppProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>My Blog</title>
      </head>
      <body>
        <Component />
      </body>
    </html>
  );
}
