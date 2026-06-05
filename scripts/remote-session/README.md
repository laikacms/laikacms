# Remote test session

Expose the local Laika CMS on a real internet domain so an end customer can test it, with a **login
wall** in front (Cloudflare Access, email one-time codes) so only people you allowlist can get in.

This is the safe, modern replacement for ngrok-to-the-open-internet —
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
plus [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/). Nothing
is open to the public — every request hits the login first, and your local ports are never directly
reachable.

The everyday way to run this is the `/remote-test` Claude command, which drives these scripts and
then switches me into "guide you as a tester" mode. The scripts also work standalone.

## What gets exposed

| Service                                            | Local            | Public hostname    |
| -------------------------------------------------- | ---------------- | ------------------ |
| `decap-cms-laika-app` (the CMS the customer opens) | `localhost:3200` | `APP_HOSTNAME`     |
| `laika-gateway` (GitHub App backend)               | `localhost:8787` | `GATEWAY_HOSTNAME` |

The OAuth callback is derived from the request origin (`auth.ts` → `${url.origin}/auth/callback`),
so it works on the public hostname with no code change — you only need to allowlist the callback in
your GitHub App.

## One-time setup

You need a domain already added to your Cloudflare account.

1. **Config**
   ```bash
   cp scripts/remote-session/config.example.env scripts/remote-session/config.env
   # edit config.env: TUNNEL_NAME, APP_HOSTNAME, GATEWAY_HOSTNAME, ALLOWED_EMAILS
   ```

2. **Tunnel** (installs cloudflared, logs in, creates the tunnel, points DNS)
   ```bash
   ./scripts/remote-session/setup-tunnel.sh
   ```

3. **Login wall** — either:
   - **Automated:** put `CF_API_TOKEN` (Access: Apps and Policies = Edit) and `CF_ACCOUNT_ID` in
     `config.env`, then
     ```bash
     ./scripts/remote-session/setup-access.sh
     ```
   - **By hand:** Zero Trust dashboard → Access → Applications → Add a self-hosted app for each
     hostname → policy _Allow_ with _Include → Emails_ set to your testers. One-time PIN login is on
     by default.

4. **GitHub App** — set the OAuth callback URL to `https://<APP_HOSTNAME>/auth/callback`, and fill
   the gateway's `apps/laika-gateway/.dev.vars` (`GITHUB_APP_*`, and
   `PUBLIC_URL=https://<GATEWAY_HOSTNAME>`).

## Run a session

```bash
./scripts/remote-session/start.sh
```

Starts both dev servers + the tunnel, prints the customer URL, and tears everything down on Ctrl-C.
Share the `APP_HOSTNAME` URL with your tester; they sign in with an allowlisted email and a one-time
code.

## Files

- `config.env` — your settings (gitignored).
- `cloudflared.yml` — generated tunnel ingress (gitignored).
- `setup-tunnel.sh` / `setup-access.sh` — one-time setup.
- `start.sh` — start/stop a live session.
