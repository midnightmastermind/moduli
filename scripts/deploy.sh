#!/usr/bin/env bash
# Deploy Moduli. Auto-detects WHERE it's run:
#   • On your LOCAL machine → ssh to the server and run this same script there.
#   • On the SERVER itself  → pull master, rebuild the client, restart pm2
#     (as the `deploy` user, who owns the repo + the pm2 daemon).
# So `npm run deploy` does the right thing from either place.
set -euo pipefail

SERVER_IP="142.93.5.142"
SERVER_USER="root"
SERVER_PATH="/var/www/moduli"
DEPLOY_USER="deploy"
PM2_APP="moduli"

# True when this machine IS the server (its IPs include the public IP).
on_server() { hostname -I 2>/dev/null | tr ' ' '\n' | grep -qx "$SERVER_IP"; }
# Run a command as `deploy` (repo + pm2 owner); skip sudo if already deploy.
as_deploy() { if [[ "$(id -un)" == "$DEPLOY_USER" ]]; then "$@"; else sudo -u "$DEPLOY_USER" "$@"; fi; }

if on_server; then
  echo "==> Deploying on the server ($(hostname))"
  cd "$SERVER_PATH"
  as_deploy git fetch origin
  as_deploy env GIT_PAGER=cat git pull --ff-only origin master
  # Build BEFORE restart: server only registers the SPA routes when
  # client/dist/index.html exists at boot.
  as_deploy npm --prefix ./client run build
  # --update-env re-applies ecosystem.config.cjs env (e.g. ASSISTANT_BACKEND=ollama)
  # so a deploy never silently reverts the backend.
  as_deploy pm2 restart "$PM2_APP" --update-env
  echo "✅ Deployed."
else
  echo "==> Not on the server — deploying over ssh to ${SERVER_USER}@${SERVER_IP}"
  ssh "${SERVER_USER}@${SERVER_IP}" "cd '${SERVER_PATH}' && ./scripts/deploy.sh"
fi
