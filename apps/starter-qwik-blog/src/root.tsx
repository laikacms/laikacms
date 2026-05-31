import { component$ } from '@builder.io/qwik';
import { QwikCityProvider, RouterOutlet, ServiceWorkerRegister } from '@builder.io/qwik-city';

export default component$(() => (
  <QwikCityProvider>
    <head>
      <meta charset="utf-8" />
      <title>LaikaCMS Qwik starter</title>
      <ServiceWorkerRegister />
    </head>
    <body
      lang="en"
      style="font-family: system-ui, sans-serif; max-width: 720px; margin: 0 auto; padding: 2rem 1rem; line-height: 1.6;"
    >
      <RouterOutlet />
    </body>
  </QwikCityProvider>
));
