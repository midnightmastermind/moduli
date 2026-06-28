#!/usr/bin/env bash
# Point the Moduli SERVER's assistant at a (tunneled) Ollama: upsert the settings
# into server/.env (idempotent), probe reachability, and restart pm2.
# Run on the SERVER, from the moduli repo root. See docs/ollama-remote.md.
#
# Usage:
#   scripts/set-assistant-env.sh --url https://ollama.viafluere.com \
#     [--model qwen2.5-coder:7b] [--cf-id <id>.access --cf-secret <secret>] [--no-restart]
set -euo pipefail

URL="" ; MODEL="qwen2.5-coder:7b" ; CF_ID="" ; CF_SECRET="" ; RESTART=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)        URL="$2";       shift 2;;
    --model)      MODEL="$2";     shift 2;;
    --cf-id)      CF_ID="$2";     shift 2;;
    --cf-secret)  CF_SECRET="$2"; shift 2;;
    --no-restart) RESTART=0;      shift;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done
[[ -z "$URL" ]] && { echo "Required: --url https://<ollama-host>"; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV="$ROOT/server/.env"
touch "$ENV"

upsert() { # upsert KEY=VALUE in $ENV, in place
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$ENV"; then
    local esc=${val//\\/\\\\}; esc=${esc//|/\\|}; esc=${esc//&/\\&}
    sed -i "s|^${key}=.*|${key}=${esc}|" "$ENV"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV"
  fi
}

upsert OLLAMA_URL "$URL"
upsert OLLAMA_MODEL "$MODEL"
upsert ASSISTANT_BACKEND "ollama"
[[ -n "$CF_ID" ]]     && upsert CF_ACCESS_CLIENT_ID "$CF_ID"
[[ -n "$CF_SECRET" ]] && upsert CF_ACCESS_CLIENT_SECRET "$CF_SECRET"

echo "Updated $ENV:"
grep -E '^(OLLAMA_URL|OLLAMA_MODEL|ASSISTANT_BACKEND|CF_ACCESS_CLIENT_ID)=' "$ENV" || true
[[ -n "$CF_SECRET" ]] && echo "CF_ACCESS_CLIENT_SECRET=***"

echo "==> Probing $URL/api/tags …"
PROBE=(-fsS -m 8)
[[ -n "$CF_ID" ]]     && PROBE+=(-H "CF-Access-Client-Id: $CF_ID")
[[ -n "$CF_SECRET" ]] && PROBE+=(-H "CF-Access-Client-Secret: $CF_SECRET")
if curl "${PROBE[@]}" "$URL/api/tags" >/dev/null 2>&1; then
  echo "✅ Ollama reachable through the tunnel."
else
  echo "⚠️  Could NOT reach $URL/api/tags — check the tunnel is running + the Access service token."
fi

if [[ "$RESTART" == "1" ]]; then
  if command -v pm2 >/dev/null 2>&1; then echo "==> pm2 restart moduli"; pm2 restart moduli; else echo "pm2 not found — restart the server manually."; fi
fi
