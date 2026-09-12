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

# THE REMOTE SCRIPT IS A *QUOTED* HEREDOC, and that is load-bearing.
#
# It used to be one big double-quoted argument to ssh, with every remote
# variable escaped as \$VAR and every inner quote as \". That works right up
# until someone adds a line with a bare " in it: the argument TERMINATES
# early, the rest is re-split into words, and the remote quietly receives an
# unquoted script. It happened immediately — `[ -n $CHANGED ]` with a
# multi-line value word-split into `test`'s arguments, `test` errored, and the
# restart guard below silently failed open on every deploy.
#
# `<<'REMOTE'` disables ALL local expansion, so what is written here is what
# the remote runs, and quotes need no escaping. Values that must cross the
# gap are passed as positional arguments instead — visible, one per line, and
# impossible to confuse with remote state. This is the same class of failure
# as the 2026-07-11 piped-pull that reported success while shipping a stale
# build: the script looked fine and the shell disagreed.
ssh "$REMOTE_HOST" bash -s -- "$REMOTE_DIR" "${DEPLOY_RESTART:-}" <<'REMOTE'
  set -e
  REMOTE_DIR="$1"
  DEPLOY_RESTART="$2"
  cd "$REMOTE_DIR"
  echo '  → Syncing to origin/master (hard reset — prod tree is disposable)...'
  # fetch+reset instead of pull: local churn (e.g. seed exports from an old
  # reseed) can abort a pull, and a piped/observed pull failure once shipped
  # a stale build while looking successful (2026-07-11). Untracked files
  # (.env, uploads/) are unaffected by reset --hard.
  BEFORE=$(git rev-parse HEAD 2>/dev/null || echo '')
  git fetch origin master
  git reset --hard origin/master
  AFTER=$(git rev-parse HEAD)
  # `< /dev/null` ON EVERY COMMAND THAT MIGHT READ STDIN. With `bash -s` the
  # SCRIPT is stdin, so a command that reads it consumes the rest of the
  # script and the deploy ends early — silently, and looking like success.
  # npm is the realistic offender (prompts, audit output); pm2 is redirected
  # for the same reason rather than because it is known to.
  echo '  → Installing server deps...'
  npm install --prefix server < /dev/null 2>&1 | tail -3
  echo '  → Building client...'
  cd client && npm install < /dev/null 2>&1 | tail -3 && npm run build < /dev/null
  cd ..

  # ============================================================
  # RESTART ONLY IF THE SERVER CHANGED.
  #
  # A pm2 restart empties the warm per-user cache, and the next grid load then
  # re-reads ~15MB of occurrences through a bandwidth-throttled Atlas
  # connection at ~100 KB/s — roughly THREE MINUTES of spinner, measured and
  # documented (2026-08-24: 'Occurrence query: 178396ms (18177)').
  #
  # For a client-only deploy that is pure loss. express.static reads from disk
  # per request and index.html is served no-cache, so a fresh bundle is live
  # the moment the build finishes — the process holds nothing derived from it.
  # Six client-only deploys in one afternoon cost ~18 minutes of someone
  # waiting at a spinner for a restart that changed nothing.
  #
  # FAIL-SAFE: it restarts unless every changed path is provably client-side
  # or documentation. An unrecognised path restarts, an empty diff restarts,
  # and a stopped process always starts. Serving stale server code is a far
  # worse failure than paying for a cold read, so the whitelist is narrow and
  # the default is the expensive-but-correct branch.
  #
  # The deploy scripts are on it because prod's COPY of them is never
  # executed — this block inlines its own commands and a deploy always runs
  # from the local checkout. Changed alongside server code, the server path
  # still wins.
  # ============================================================
  RESTART=1
  if [ -n "$BEFORE" ] && [ "$BEFORE" != "$AFTER" ]; then
    CHANGED=$(git diff --name-only "$BEFORE" "$AFTER")
    # printf, not echo: CHANGED is multi-line and must reach grep as lines.
    if [ -n "$CHANGED" ] && ! printf '%s\n' "$CHANGED" | grep -qvE '^(client/|docs/|screenshots/|\.remember/|deploy(data)?\.sh$|[^/]*\.md$)'; then
      RESTART=0
    fi
  fi
  # A process that is not running must always be started, whatever changed.
  pm2 describe moduli < /dev/null >/dev/null 2>&1 || RESTART=1
  # Escape hatch for a config/.env change git cannot see. An `if` and not
  # `[ ] && x`: under `set -e` that compound returns non-zero whenever the
  # test is false — the normal case — and kills the deploy before the restart.
  if [ "$DEPLOY_RESTART" = "1" ]; then RESTART=1; fi

  if [ "$RESTART" = "1" ]; then
    echo '  → Restarting server (pm2)...'
    pm2 restart moduli < /dev/null || pm2 start ecosystem.config.cjs < /dev/null
    pm2 save < /dev/null
  else
    echo '  → Server unchanged — NOT restarting (keeps the warm cache; a'
    echo '    restart costs the next load a ~180s cold Atlas read).'
    echo '    Force with: DEPLOY_RESTART=1 ./deploy.sh'
  fi
  echo '  ✅ Deploy complete!'
REMOTE

echo ""
echo "🎉 Deployment finished!"
