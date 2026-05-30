// Runtime secrets supplied via `.dev.vars` (local) / `wrangler secret put` (prod).
// They are documented in `wrangler.toml`, but `wrangler types` cannot infer
// secret keys, so the generated `interface Env` omits them. This ambient
// declaration merges with that generated `interface Env`, giving `c.env.*`
// (and `globalThis.Env`) the correct string types. Keep in sync with the
// secret list in `wrangler.toml`.
interface Env {
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_APP_CLIENT_ID: string;
  GITHUB_APP_CLIENT_SECRET: string;
  PUBLIC_URL: string;
}
