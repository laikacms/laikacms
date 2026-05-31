import { defineConfig } from 'waku/config';

export default defineConfig({
  // Use node adapter (default for local dev / production Node.js).
  // Switch to 'waku/adapters/cloudflare-workers' etc. for edge deployments.
  unstable_adapter: 'waku/adapters/node',
});
