#!/bin/bash
# deploy.sh — Build, commit, push, then deploy to production server
# Usage: ./deploy.sh "commit message"
# Server: 192.168.3.133 (joshpoms) | /var/www/moduli

set -e

COMMIT_MSG="${1:-"deploy: update site"}"
REMOTE_HOST="joshpoms@192.168.3.133"
REMOTE_DIR="/var/www/moduli"

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
echo "   (You will be prompted for the password)"

ssh "$REMOTE_HOST" "
  set -e
  cd $REMOTE_DIR
  echo '  → Pulling latest...'
  git pull
  echo '  → Installing server deps...'
  npm install --prefix server 2>&1 | tail -3
  echo '  → Building client...'
  cd client && npm install 2>&1 | tail -3 && npm run build
  cd ..
  echo '  → Restarting server (pm2)...'
  pm2 restart moduli 2>/dev/null || pm2 start server/server.js --name moduli
  echo '  ✅ Deploy complete!'
"

echo ""
echo "🎉 Deployment finished!"
