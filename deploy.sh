#!/bin/bash
# deploy.sh — Build, commit, push, then deploy to production server
# Usage: ./deploy.sh "commit message"
# Server: <DOMAIN> (deploy@) | /var/www/moduli  [SSH keys]

set -e

COMMIT_MSG="${1:-"deploy: update site"}"
REMOTE_HOST="deploy@DOMAIN"
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
  pm2 restart moduli || pm2 start ecosystem.config.cjs
  pm2 save
  echo '  ✅ Deploy complete!'
"

echo ""
echo "🎉 Deployment finished!"
