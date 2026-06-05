#!/usr/bin/env bash
#
# Go live: start the two dev servers and the Cloudflare tunnel together, then
# print the public URL a tester should open. Ctrl-C tears everything down.
#
# Prerequisite: run setup-tunnel.sh once first (and setup-access.sh for the
# login wall). See README.md.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CONFIG_ENV="$HERE/config.env"
CONFIG_YML="$HERE/cloudflared.yml"

[[ -f "$CONFIG_ENV" ]] || { echo "✗ Missing config.env — see README.md"; exit 1; }
[[ -f "$CONFIG_YML" ]] || { echo "✗ Missing cloudflared.yml — run setup-tunnel.sh first"; exit 1; }
# shellcheck disable=SC1090
source "$CONFIG_ENV"

pids=()
cleanup() {
  echo
  echo "→ Shutting down test session…"
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd "$ROOT"

echo "→ Starting CMS app (port ${APP_PORT:-3200})…"
pnpm --filter @laikacloud/decap-cms-laika-app dev & pids+=("$!")

echo "→ Starting gateway (port ${GATEWAY_PORT:-8787})…"
pnpm --filter @laikacms/laika-gateway dev & pids+=("$!")

echo "→ Starting Cloudflare tunnel…"
cloudflared tunnel --config "$CONFIG_YML" run "$TUNNEL_NAME" & pids+=("$!")

cat <<LIVE

────────────────────────────────────────────────────────────
  Remote test session is LIVE.

  Open this and sign in with an allowlisted email:
      https://${APP_HOSTNAME}

  (Gateway, for the GitHub flow: https://${GATEWAY_HOSTNAME})

  Press Ctrl-C here to end the session and take it offline.
────────────────────────────────────────────────────────────

LIVE

wait
