import { createHandler, StartServer } from '@solidjs/start/server';

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>LaikaCMS SolidStart starter</title>
          {assets}
        </head>
        <body style="font-family: system-ui, sans-serif; max-width: 720px; margin: 0 auto; padding: 2rem 1rem; line-height: 1.6;">
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
));
