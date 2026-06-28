#!/usr/bin/env bash
# provision.sh — one-time setup for a fresh Ubuntu 24.04 (ARM64) box.
# Run as root on the server:  bash provision.sh
set -euo pipefail

# ── Config (edit these before running) ───────────────────────────────────────
DOMAIN="viafluere.com"
if [ "$DOMAIN" = "moduli.example.com" ]; then echo "ERROR: set DOMAIN at the top of provision.sh before running"; exit 1; fi
REPO_URL="https://github.com/midnightmastermind/moduli.git"
APP_DIR="/var/www/moduli"
DEPLOY_USER="deploy"

# Local LLM (Ollama). Left OFF for the small DigitalOcean box — the assistant
# falls back to the Anthropic API (set ANTHROPIC_API_KEY in server/.env) or a
# built-in deterministic responder. Flip to 1 (and use a box with >=16GB RAM)
# to install, enable, and pull the model. All the Ollama logic stays below;
# only this switch decides whether it runs.
ENABLE_OLLAMA=0
OLLAMA_PULL_MODEL="llama3.2:3b"   # matches server/.env OLLAMA_MODEL when enabled

echo "==> 1/8  System packages"
apt-get update -y
apt-get install -y curl git nginx ufw

# Swap: the client build (vite) runs on this box and can OOM on a small droplet.
# 2GB swapfile gives the build + Node headroom. Skipped if any swap is active.
if [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
  echo "    + creating 2GB swapfile"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

echo "==> 2/8  Node 22 (NodeSource)"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1)" != "v22" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v pm2 >/dev/null; then npm install -g pm2; fi

echo "==> 3/8  Non-root deploy user"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
  mkdir -p /home/$DEPLOY_USER/.ssh
  chmod 700 /home/$DEPLOY_USER/.ssh
  # Copy root's authorized key so you can SSH in as deploy.
  if [ -f /root/.ssh/authorized_keys ]; then
    cp /root/.ssh/authorized_keys /home/$DEPLOY_USER/.ssh/authorized_keys
    chown $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh/authorized_keys
    chmod 600 /home/$DEPLOY_USER/.ssh/authorized_keys
  else
    echo "    !! /root/.ssh/authorized_keys not found — add your public key manually to /home/$DEPLOY_USER/.ssh/authorized_keys"
  fi
  chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh
fi

echo "==> 4/8  Firewall (UFW): only 22/80/443"
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

echo "==> 5/8  Ollama (systemd, localhost-bound) + model"
if [ "$ENABLE_OLLAMA" = "1" ]; then
  if ! command -v ollama >/dev/null; then
    curl -fsSL https://ollama.com/install.sh | sh
  fi
  # Bind to localhost only (default is already 127.0.0.1:11434; make it explicit).
  mkdir -p /etc/systemd/system/ollama.service.d
  cat >/etc/systemd/system/ollama.service.d/override.conf <<'EOF'
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11434"
EOF
  systemctl daemon-reload
  systemctl enable --now ollama
  ollama pull "$OLLAMA_PULL_MODEL"
else
  echo "    (skipped — ENABLE_OLLAMA=0; assistant uses Anthropic API or fallback)"
fi

echo "==> 6/8  Clone repo + install deps + build client"
mkdir -p "$(dirname "$APP_DIR")"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
fi
chown -R $DEPLOY_USER:$DEPLOY_USER "$APP_DIR"
cd "$APP_DIR"
sudo -u $DEPLOY_USER npm install --prefix server
sudo -u $DEPLOY_USER npm install --prefix client
sudo -u $DEPLOY_USER npm --prefix client run build

echo "==> 7/8  server/.env"
if [ ! -f "$APP_DIR/server/.env" ]; then
  echo "    !! No server/.env found."
  echo "    Create it from server/.env.production.example, then re-run from step 8."
  echo "    Generate secrets:  openssl rand -hex 32   (JWT_SECRET)"
  echo "                       openssl rand -hex 24   (ASSISTANT_API_TOKEN)"
  exit 1
fi

echo "==> 8/8  Nginx site + pm2 app"
# Install the HTTP-only nginx config with DOMAIN substituted.
sed "s/DOMAIN/$DOMAIN/g" "$APP_DIR/deploy/nginx/moduli.conf" >/etc/nginx/sites-available/moduli
ln -sf /etc/nginx/sites-available/moduli /etc/nginx/sites-enabled/moduli
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# Start the app as the deploy user via pm2, persist across reboot.
sudo -u $DEPLOY_USER bash -c "cd $APP_DIR && pm2 startOrRestart ecosystem.config.cjs && pm2 save"
if ! systemctl is-enabled pm2-$DEPLOY_USER >/dev/null 2>&1; then
  env PATH="$PATH:/usr/bin" pm2 startup systemd -u $DEPLOY_USER --hp /home/$DEPLOY_USER | tail -1 | bash
fi

echo ""
echo "✅ Provision complete. App should be live on http://$DOMAIN"
echo "   Next: issue TLS  ->  certbot --nginx -d $DOMAIN -d www.$DOMAIN"
echo "   Then seed Atlas  ->  cd $APP_DIR && npm run seed:live"
