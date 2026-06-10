import { minimalBlogConfig } from '@laikacms/decap-integrations/embedded';

// minimalBlogConfig() constructs a plain config object — no node:fs imports —
// so it is safe to call from Workers V8 isolates.
export const blogCollections = minimalBlogConfig().collections;
