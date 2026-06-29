#!/usr/bin/env bash
# Re-seed the live grid via createLiveData, then restart. Same local/server
# auto-detection as deploy.sh (runs here if on the server, else ssh's in).
#
# ⚠️  DESTRUCTIVE: createLiveData drops the existing live grid first, so any
#     data created/edited in the app (imports, field values, layout, …) is
#     replaced with fresh seed data. Only run when you want a clean reset.
set -euo pipefail

SERVER_IP="142.93.5.142"
SERVER_USER="root"
SERVER_PATH="/var/www/moduli"
DEPLOY_USER="deploy"
PM2_APP="moduli"

on_server() { hostname -I 2>/dev/null | tr ' ' '\n' | grep -qx "$SERVER_IP"; }
as_deploy() { if [[ "$(id -un)" == "$DEPLOY_USER" ]]; then "$@"; else sudo -u "$DEPLOY_USER" "$@"; fi; }

if on_server; then
  echo "==> Re-seeding live data on the server ($(hostname)) — DESTRUCTIVE"
  cd "$SERVER_PATH"
  as_deploy node --env-file=server/.env server/scripts/createLiveData.js
  as_deploy pm2 restart "$PM2_APP"
  echo "✅ Re-seeded."
else
  echo "==> Not on the server — re-seeding over ssh to ${SERVER_USER}@${SERVER_IP}"
  ssh "${SERVER_USER}@${SERVER_IP}" "cd '${SERVER_PATH}' && ./scripts/deploydata.sh"
fi
