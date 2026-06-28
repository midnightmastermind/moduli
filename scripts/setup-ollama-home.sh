#!/usr/bin/env bash
# Set up a HOME Ollama and expose it to the Moduli server via a Cloudflare Tunnel
# (Option B — see docs/ollama-remote.md). Run this on the machine where Ollama
# runs. Idempotent: safe to re-run.
#
# Usage:
#   scripts/setup-ollama-home.sh --hostname ollama.viafluere.com \
#     [--model qwen2.5-coder:7b] [--tunnel moduli-ollama] [--port 11434]
#
# When it finishes, create a Cloudflare Access service token for the hostname
# (Zero Trust dashboard), then run scripts/set-assistant-env.sh on the SERVER.
set -euo pipefail

HOSTNAME="" ; MODEL="qwen2.5-coder:7b" ; TUNNEL="moduli-ollama" ; PORT=11434
while [[ $# -gt 0 ]]; do
  case "$1" in
    --hostname) HOSTNAME="$2"; shift 2;;
    --model)    MODEL="$2";    shift 2;;
    --tunnel)   TUNNEL="$2";   shift 2;;
    --port)     PORT="$2";     shift 2;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done
[[ -z "$HOSTNAME" ]] && { echo "Required: --hostname <ollama.yourdomain.com>"; exit 1; }

echo "==> 1/5 Ollama"
if ! command -v ollama >/dev/null 2>&1; then
  echo "Installing ollama…"; curl -fsSL https://ollama.com/install.sh | sh
fi
# Bind to all interfaces so the tunnel can reach it (default is localhost-only).
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q '^ollama.service'; then
  sudo mkdir -p /etc/systemd/system/ollama.service.d
  printf '[Service]\nEnvironment=OLLAMA_HOST=0.0.0.0:%s\n' "$PORT" \
    | sudo tee /etc/systemd/system/ollama.service.d/override.conf >/dev/null
  sudo systemctl daemon-reload
  sudo systemctl restart ollama
  echo "ollama bound to 0.0.0.0:$PORT (systemd override)"
else
  echo "No systemd ollama service (WSL/manual)."
  if ! curl -fsS "http://localhost:$PORT/api/tags" >/dev/null 2>&1; then
    echo "Starting: OLLAMA_HOST=0.0.0.0:$PORT ollama serve (background → /tmp/ollama.log)"
    OLLAMA_HOST=0.0.0.0:$PORT nohup ollama serve >/tmp/ollama.log 2>&1 &
    sleep 2
  else
    echo "Ollama already up on :$PORT — ensure it was started with OLLAMA_HOST=0.0.0.0:$PORT"
  fi
fi

echo "==> 2/5 Pull model: $MODEL"
ollama pull "$MODEL"

echo "==> 3/5 cloudflared"
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared not found. Install it, then re-run:"
  echo "  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi
if [[ ! -f "$HOME/.cloudflared/cert.pem" ]]; then
  echo "Authorizing cloudflared (opens a browser)…"
  cloudflared tunnel login
fi

echo "==> 4/5 Tunnel: $TUNNEL"
if ! cloudflared tunnel list 2>/dev/null | awk 'NR>1{print $2}' | grep -qx "$TUNNEL"; then
  cloudflared tunnel create "$TUNNEL"
fi
TUNNEL_ID="$(cloudflared tunnel list | awk -v n="$TUNNEL" 'NR>1 && $2==n {print $1}')"
[[ -z "$TUNNEL_ID" ]] && { echo "Could not resolve tunnel id for $TUNNEL"; exit 1; }
cloudflared tunnel route dns "$TUNNEL" "$HOSTNAME" || true

CFG="$HOME/.cloudflared/config.yml"
cat > "$CFG" <<YML
tunnel: $TUNNEL_ID
credentials-file: $HOME/.cloudflared/$TUNNEL_ID.json
ingress:
  - hostname: $HOSTNAME
    service: http://localhost:$PORT
  - service: http_status:404
YML
echo "Wrote $CFG"

echo "==> 5/5 Run the tunnel"
if command -v systemctl >/dev/null 2>&1; then
  sudo cloudflared service install 2>/dev/null || true
  sudo systemctl restart cloudflared 2>/dev/null || { nohup cloudflared tunnel run "$TUNNEL" >/tmp/cloudflared.log 2>&1 & }
else
  echo "Starting tunnel in background → /tmp/cloudflared.log"
  nohup cloudflared tunnel run "$TUNNEL" >/tmp/cloudflared.log 2>&1 &
fi

cat <<DONE

✅ Home Ollama + Cloudflare Tunnel set up.
   Model:  $MODEL
   Tunnel: $TUNNEL ($TUNNEL_ID)
   Route:  https://$HOSTNAME  ->  http://localhost:$PORT

NEXT — Cloudflare Zero Trust dashboard (one-time), since Ollama has no auth:
  1. Access → Applications → add a self-hosted app for: $HOSTNAME
  2. Access → Service Auth → create a Service Token (copy Client ID + Secret)
  3. Add an Access policy on the app: Allow when Service Token = that token
  4. On the SERVER (moduli repo root) run:
       scripts/set-assistant-env.sh --url https://$HOSTNAME --model $MODEL \\
         --cf-id <client-id>.access --cf-secret <client-secret>
DONE
