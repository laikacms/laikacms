// @ts-types="npm:@laikacms/decap-integrations/embedded"
import { createEmbeddedLaika, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';

// Deno: Deno.cwd() is the standard way to get the working directory, but
// node:process.cwd() also works thanks to the `node:` polyfill. We use
// Deno.cwd() to keep the file Deno-native.
export const laika = createEmbeddedLaika({
  contentDir: `${Deno.cwd()}/content`,
  decapConfig: minimalBlogConfig(),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});
