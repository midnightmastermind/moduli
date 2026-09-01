#!/bin/bash
# deploy.sh — Build, commit, push, then deploy to production server
# Usage: ./deploy.sh "commit message"
# Server: viafluere.com (deploy@) | /var/www/moduli  [SSH keys]

set -e

COMMIT_MSG="${1:-"deploy: update site"}"
REMOTE_HOST="deploy@viafluere.com"   # resolves once the A record points at the droplet; use deploy@<IP> if DNS hasn't propagated yet
REMOTE_DIR="/var/www/moduli"

# Fail fast if the placeholder host was never filled in — otherwise the script
# builds, commits, and pushes, then dies at the SSH step with a confusing DNS error.
if [ "$REMOTE_HOST" = "deploy@DOMAIN" ]; then
  echo "ERROR: set REMOTE_HOST at the top of deploy.sh (replace DOMAIN) before running." >&2
  exit 1
fi

# ============================================================
# STEP 1: Build the client
# ============================================================
echo "🔨 Building client..."
cd "$(dirname "$0")/client"
~/.nvm/versions/node/v22.21.1/bin/npm run build
cd "$(dirname "$0")"

echo "✅ Build complete"

# ============================================================
# STEP 2: Git commit + push
# ============================================================
echo ""
echo "📦 Committing and pushing..."
git add -A
git commit -m "$COMMIT_MSG" || echo "  (nothing to commit)"
git push

echo "✅ Pushed to origin"

# ============================================================
# STEP 3: SSH to server, pull, and rebuild
# ============================================================
echo ""
echo "🚀 Deploying to $REMOTE_HOST:$REMOTE_DIR ..."

ssh "$REMOTE_HOST" "
  set -e
  export DEPLOY_RESTART='${DEPLOY_RESTART:-}'
  cd $REMOTE_DIR
  echo '  → Syncing to origin/master (hard reset — prod tree is disposable)...'
  # fetch+reset instead of pull: local churn (e.g. seed exports from an old
  # reseed) can abort a pull, and a piped/observed pull failure once shipped
  # a stale build while looking successful (2026-07-11). Untracked files
  # (.env, uploads/) are unaffected by reset --hard.
  BEFORE=\$(git rev-parse HEAD 2>/dev/null || echo '')
  git fetch origin master
  git reset --hard origin/master
  AFTER=\$(git rev-parse HEAD)
  echo '  → Installing server deps...'
  npm install --prefix server 2>&1 | tail -3
  echo '  → Building client...'
  cd client && npm install 2>&1 | tail -3 && npm run build
  cd ..

  # ============================================================
  # RESTART ONLY IF THE SERVER CHANGED.
  #
  # A pm2 restart empties the warm per-user cache, and the next grid load then
  # re-reads ~15MB of occurrences through a bandwidth-throttled Atlas
  # connection at ~100 KB/s — roughly THREE MINUTES of spinner, measured and
  # documented (2026-08-24: 'Occurrence query: 178396ms (18177)').
  #
  # For a client-only deploy that is pure loss. \`express.static\` reads from
  # disk per request and index.html is served no-cache, so a fresh bundle is
  # live the moment the build finishes — the process holds nothing derived
  # from it. Six client-only deploys in one afternoon cost ~18 minutes of
  # someone waiting at a spinner for a restart that changed nothing.
  #
  # FAIL-SAFE: it restarts unless every changed path is provably client-side
  # or documentation. An unrecognised path restarts. Serving stale server code
  # is a far worse failure than paying for a cold read, so the whitelist is
  # narrow and the default is to restart.
  #
  # The deploy scripts themselves are on it because prod's COPY of them is
  # never executed — the ssh block above inlines its own commands, and a
  # deploy always runs from the local checkout. A change to one of them
  # alongside a server change still restarts, on the server path.
  RESTART=1
  if [ -n "\$BEFORE" ] && [ "\$BEFORE" != "\$AFTER" ]; then
    CHANGED=\$(git diff --name-only "\$BEFORE" "\$AFTER")
    if [ -n "\$CHANGED" ] && ! echo "\$CHANGED" | grep -qvE '^(client/|docs/|screenshots/|\.remember/|deploy(data)?\.sh\$|[^/]*\.md\$)'; then
      RESTART=0
    fi
  fi
  # A process that is not running must always be started, whatever changed.
  pm2 describe moduli >/dev/null 2>&1 || RESTART=1
  # Escape hatch for a config/.env change git cannot see. An \`if\` and not
  # \`[ ] && x\`: under \`set -e\` that compound returns non-zero whenever the
  # test is false — the normal case — and kills the deploy before the restart.
  if [ "\$DEPLOY_RESTART" = "1" ]; then RESTART=1; fi

  if [ "\$RESTART" = "1" ]; then
    echo '  → Restarting server (pm2)...'
    pm2 restart moduli || pm2 start ecosystem.config.cjs
    pm2 save
  else
    echo '  → Server unchanged — NOT restarting (keeps the warm cache; a'
    echo '    restart costs the next load a ~180s cold Atlas read).'
    echo '    Force with: DEPLOY_RESTART=1 ./deploy.sh'
  fi
  echo '  ✅ Deploy complete!'
"

echo ""
echo "🎉 Deployment finished!"
