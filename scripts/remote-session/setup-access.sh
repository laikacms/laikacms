#!/usr/bin/env bash
#
# Put a Cloudflare Access (Zero Trust) login wall in front of both hostnames.
# Testers must enter an allowlisted email and a one-time code before they ever
# reach the app — this is the "sits behind a login" part.
#
# Needs CF_API_TOKEN + CF_ACCOUNT_ID in config.env. If you'd rather click it
# together in the dashboard, skip this script and follow README.md instead.
# Safe to re-run: existing apps with the same name are updated in place.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_ENV="$HERE/config.env"
# shellcheck disable=SC1090
source "$CONFIG_ENV"

: "${CF_API_TOKEN:?set CF_API_TOKEN in config.env (or use the dashboard — see README.md)}"
: "${CF_ACCOUNT_ID:?set CF_ACCOUNT_ID in config.env}"
: "${ALLOWED_EMAILS:?set ALLOWED_EMAILS in config.env}"
: "${APP_HOSTNAME:?}"
: "${GATEWAY_HOSTNAME:?}"

API="https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps"

# Build the policy "include" rules (one email rule per allowlisted address).
INCLUDE_JSON="$(ALLOWED_EMAILS="$ALLOWED_EMAILS" python3 - <<'PY'
import json, os
emails = [e.strip() for e in os.environ["ALLOWED_EMAILS"].split(",") if e.strip()]
print(json.dumps([{"email": {"email": e}} for e in emails]))
PY
)"

cf() { # cf METHOD URL [BODY]
  local method="$1" url="$2" body="${3:-}"
  curl -sS -X "$method" "$url" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    ${body:+--data "$body"}
}

setup_one() { # setup_one HOSTNAME FRIENDLY_NAME
  local domain="$1" name="$2"

  # Find an existing app for this hostname, otherwise create it.
  local app_id
  app_id="$(cf GET "$API" | python3 -c "
import sys, json
data = json.load(sys.stdin).get('result') or []
print(next((a['id'] for a in data if a.get('domain')=='${domain}'), ''))
")"

  local app_body
  app_body="$(python3 -c "import json;print(json.dumps({
    'name': '${name}',
    'domain': '${domain}',
    'type': 'self_hosted',
    'session_duration': '24h'
  }))")"

  if [[ -z "$app_id" ]]; then
    echo "→ Creating Access app for ${domain}…"
    app_id="$(cf POST "$API" "$app_body" | python3 -c "import sys,json;print(json.load(sys.stdin)['result']['id'])")"
  else
    echo "→ Updating Access app for ${domain}…"
    cf PUT "${API}/${app_id}" "$app_body" >/dev/null
  fi
  echo "  app id ${app_id}"

  # Replace policies with a single allow-by-email rule (email OTP login).
  local pol_body
  pol_body="$(python3 -c "import json,sys;print(json.dumps({
    'name': 'Allowlisted testers',
    'decision': 'allow',
    'include': json.loads(sys.argv[1])
  }))" "$INCLUDE_JSON")"

  # Delete existing policies, then add ours (keeps re-runs clean).
  cf GET "${API}/${app_id}/policies" | python3 -c "
import sys, json
for p in (json.load(sys.stdin).get('result') or []):
    print(p['id'])
" | while read -r pid; do
    [[ -n "$pid" ]] && cf DELETE "${API}/${app_id}/policies/${pid}" >/dev/null
  done
  cf POST "${API}/${app_id}/policies" "$pol_body" >/dev/null
  echo "✓ ${domain} is now behind the login (allowed: ${ALLOWED_EMAILS})"
}

setup_one "$APP_HOSTNAME"     "Laika CMS (test)"
setup_one "$GATEWAY_HOSTNAME" "Laika Gateway (test)"

echo
echo "✓ Login wall configured. Testers sign in with email OTP at the hostnames above."
