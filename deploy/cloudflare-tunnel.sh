#!/usr/bin/env bash
# cloudflare-tunnel.sh — expose your local Moduli/Viafluere app on viafluere.com
# via a Cloudflare Tunnel (no port forwarding, no static IP, free, automatic HTTPS).
#
# RUN THIS IN YOUR OWN WSL TERMINAL (not through the assistant) — it opens a
# browser for Cloudflare login and runs a long-lived tunnel process.
#
# PREREQUISITES (do these first, once):
#   1. Create a free Cloudflare account at https://dash.cloudflare.com/sign-up
#   2. Add the site "viafluere.com" (Websites -> Add a site -> Free plan).
#      Cloudflare gives you TWO nameservers (e.g. xxx.ns.cloudflare.com).
#   3. At Dynadot, set viafluere.com's nameservers to those two Cloudflare ones.
#      (Dynadot -> My Domains -> viafluere.com -> Nameservers -> Cloudflare's.)
#   4. Wait until Cloudflare shows the zone as "Active" (minutes to a few hours).
#
# Then run:  bash deploy/cloudflare-tunnel.sh
set -euo pipefail

DOMAIN="viafluere.com"
TUNNEL_NAME="viafluere"
APP_PORT="5000"

# ── 1. Install cloudflared if missing ────────────────────────────────────────
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "==> Installing cloudflared (Cloudflare apt repo)…"
  sudo mkdir -p --mode=0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
    | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
    | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y cloudflared
fi
echo "cloudflared: $(cloudflared --version)"

# ── 2. Authenticate (opens your browser; pick the viafluere.com zone) ─────────
if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
  echo "==> Logging in to Cloudflare (a browser window will open)…"
  cloudflared tunnel login
fi

# ── 3. Create the tunnel (idempotent) ────────────────────────────────────────
if ! cloudflared tunnel list 2>/dev/null | grep -q "$TUNNEL_NAME"; then
  echo "==> Creating tunnel '$TUNNEL_NAME'…"
  cloudflared tunnel create "$TUNNEL_NAME"
fi
TUNNEL_ID="$(cloudflared tunnel list | awk -v n="$TUNNEL_NAME" '$2==n{print $1}')"
echo "tunnel id: $TUNNEL_ID"

# ── 4. Write the config (maps the domain -> your local app) ───────────────────
CONF="$HOME/.cloudflared/config.yml"
echo "==> Writing $CONF"
cat > "$CONF" <<EOF
tunnel: $TUNNEL_ID
credentials-file: $HOME/.cloudflared/$TUNNEL_ID.json

ingress:
  - hostname: $DOMAIN
    service: http://localhost:$APP_PORT
  - hostname: www.$DOMAIN
    service: http://localhost:$APP_PORT
  - service: http_status:404
EOF

# ── 5. Point the domain's DNS at the tunnel (idempotent) ──────────────────────
echo "==> Routing DNS $DOMAIN + www.$DOMAIN -> tunnel"
cloudflared tunnel route dns "$TUNNEL_NAME" "$DOMAIN"     || true
cloudflared tunnel route dns "$TUNNEL_NAME" "www.$DOMAIN" || true

echo ""
echo "✅ Setup complete."
echo "   Start your app (separate terminal):  cd ~/moduli && npm run serve"
echo "   Then run the tunnel:                 cloudflared tunnel run $TUNNEL_NAME"
echo "   Your site will be live at:           https://$DOMAIN"
echo ""
echo "   (Optional) install the tunnel as an always-on service so it survives"
echo "   reboots:  sudo cloudflared service install"
