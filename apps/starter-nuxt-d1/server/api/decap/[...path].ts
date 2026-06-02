import { makeLaika } from '../../utils/laika';

// With Nitro's cloudflare-pages preset, event.context.cloudflare.request is
// the original Cloudflare Request — use it directly so laika.fetch receives
// the full URL, headers, and body without any wrapping.
export default defineEventHandler(event => {
  const { env, request } = event.context.cloudflare;
  return makeLaika(env.DB).fetch(request);
});
