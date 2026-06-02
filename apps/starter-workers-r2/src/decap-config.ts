import { minimalBlogConfig } from '@laikacms/decap-integrations/embedded';

// minimalBlogConfig() lives in the /embedded subpath, but the function itself
// only constructs a plain object — no node:fs imports — so it's safe to use
// from Workers code. The /workers preset only avoids importing the wiring
// helper that actually does filesystem work.
export const decapConfig = minimalBlogConfig();
