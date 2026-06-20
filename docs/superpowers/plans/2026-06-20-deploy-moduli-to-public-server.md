# Deploy Moduli to a Public Server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Moduli to a public, HTTPS, custom-domain server on a single Hetzner VPS that also runs Ollama, with persistent uploads and working websockets.

**Architecture:** One Node process (`server/server.js`) serves both the API/websocket and the built React client. Nginx terminates TLS on 443 and reverse-proxies to Node on `localhost:5000`, passing websocket upgrade headers. MongoDB Atlas (M0) is the database; uploads live on the box's disk. Ollama runs as a localhost-bound systemd service. pm2 keeps the app alive across crashes/reboots.

**Tech Stack:** Ubuntu 24.04 (ARM64), Node 22, pm2, Nginx, Certbot (Let's Encrypt), Ollama (`qwen2.5-coder:7b`), MongoDB Atlas, Dynadot DNS.

> **Note on TDD:** This is an infrastructure/operations plan, not application code. There are no unit tests to write. Each task ends with an explicit **verification gate** — a command whose observed output proves the step worked — which serves the same review-checkpoint role. Do not mark a task done until its verification output matches.

## Global Constraints

- **Source spec:** `docs/superpowers/specs/2026-06-19-deploy-moduli-to-public-server-design.md` — authoritative for any decision not spelled out here.
- **Server:** Hetzner Cloud **CAX31** (ARM64, 8 vCPU, 16GB RAM, 160GB disk), Ubuntu 24.04 LTS. Budget ~$15/mo + domain.
- **App name in pm2:** `moduli` (must match `deploy.sh`).
- **App port:** `5000`, bound `0.0.0.0` (Node default; Nginx is the only public listener).
- **Firewall:** UFW allows **only** 22, 80, 443. Ollama (11434) and Node (5000) stay internal — never exposed.
- **`JWT_SECRET` MUST be a strong random value in prod** (`openssl rand -hex 32`). The code default `"SUPER_SECRET"` (`server/server.js:65`, `server/utils/jwts.js:3`) is forgeable and unacceptable in production.
- **Persistent disk required** for `server/uploads` — never deploy to ephemeral-disk PaaS.
- **`server/.env` is NEVER committed.** It is written directly on the box.
- **No backwards-compat shims / alias fallbacks** in any script (per project convention `feedback_no_fallbacks`).
- **Ollama binds `127.0.0.1` only.**
- **Deploy user is non-root** (`deploy`), SSH-keys-only, password auth disabled.

---

### Task 0: Provision external infrastructure (manual, no code)

This task produces three facts that every later task consumes. It is manual cloud-console work; there is nothing to commit, but the verification gate is mandatory before continuing.

**Interfaces:**
- Produces: `SERVER_IP` (Hetzner public IPv4), `MONGO_URI` (Atlas SRV string), `DOMAIN` (e.g. `moduli.example.com`). Record these in a local scratch note — they are NOT committed.

- [ ] **Step 1: Create the Hetzner server**

In the Hetzner Cloud console: new project → add server → Location (pick one near you) → Image **Ubuntu 24.04** → Type **CAX31** (Arm64 Ampere) → add your SSH public key → create. Note the assigned public IPv4 as `SERVER_IP`.

- [ ] **Step 2: Create the MongoDB Atlas cluster**

Atlas → Build a Database → **M0 (free)** → choose a region → create. Under **Database Access**, create a DB user with a strong password. Under **Network Access**, add `SERVER_IP/32` (the Hetzner IP) to the IP access list. Under **Connect → Drivers**, copy the SRV connection string and substitute the DB user/password — this is `MONGO_URI`. Append a database name (e.g. `/moduli`) before the `?` query string.

- [ ] **Step 3: Point DNS at the server (Dynadot)**

Dynadot → your domain → DNS settings → add two A records:
- `@` → `SERVER_IP`
- `www` → `SERVER_IP`

Record the full hostname you'll use as `DOMAIN`.

- [ ] **Step 4: Verification gate**

```bash
# DNS resolves to your server (may take minutes-hours to propagate):
dig +short DOMAIN
# Expected: prints SERVER_IP

# SSH as root works with your key:
ssh root@SERVER_IP "uname -m && lsb_release -ds"
# Expected: "aarch64" and "Ubuntu 24.04 ... LTS"
```

Do not proceed until `dig` returns `SERVER_IP` and SSH succeeds.

---

### Task 1: Author the production env template

Create a committed, secret-free template documenting every variable the box needs. The real `.env` is derived from it on the server and never committed.

**Files:**
- Create: `server/.env.production.example`

**Interfaces:**
- Consumes: nothing.
- Produces: the canonical list of prod env vars, consumed by `provision.sh` (Task 4) and `deploy.sh` (Task 7) documentation.

- [ ] **Step 1: Write the template**

Create `server/.env.production.example`:

```bash
# Moduli production environment — copy to server/.env on the box and fill in.
# NEVER commit the filled-in .env.

# MongoDB Atlas SRV connection string (includes db user + password + /moduli db name)
MONGO_URI=mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/moduli?retryWrites=true&w=majority

# App listen port (Nginx proxies to this on localhost)
PORT=5000

# CRITICAL: strong random secret. Generate with: openssl rand -hex 32
JWT_SECRET=replace-with-openssl-rand-hex-32

# AI assistant (Ollama runs locally on the box)
OLLAMA_MODEL=qwen2.5-coder:7b

# Random token guarding assistant API routes. Generate with: openssl rand -hex 24
ASSISTANT_API_TOKEN=replace-with-openssl-rand-hex-24

# Optional cloud fallback for the assistant if Ollama is down. Leave blank to disable.
ANTHROPIC_API_KEY=
```

- [ ] **Step 2: Verify no real secrets are present**

```bash
grep -nE "mongodb\+srv://[^U]|sk-ant|[a-f0-9]{32}" server/.env.production.example
# Expected: no output (only placeholders, no real credentials)
```

- [ ] **Step 3: Confirm .env is gitignored**

```bash
git check-ignore server/.env
# Expected: prints "server/.env" (it is ignored). If no output, add it to .gitignore in this step.
```

- [ ] **Step 4: Commit**

```bash
git add server/.env.production.example
git commit -m "build: add production env template for server deploy"
```

---

### Task 2: Author the Nginx site config

Nginx is the only public listener. It must reverse-proxy to Node, pass websocket upgrade headers (Socket.io will not work without them), and raise the upload body limit above the app's 50MB multer cap.

**Files:**
- Create: `deploy/nginx/moduli.conf`

**Interfaces:**
- Consumes: `DOMAIN`, app on `127.0.0.1:5000`.
- Produces: a server block installed by `provision.sh` to `/etc/nginx/sites-available/moduli`. Certbot will later inject the TLS lines and the 80→443 redirect.

- [ ] **Step 1: Write the config (pre-TLS form)**

Create `deploy/nginx/moduli.conf`. This is the HTTP-only form; Certbot rewrites it to add 443 + the redirect in Task 6.

```nginx
# Moduli — reverse proxy to the Node app on localhost:5000.
# Certbot will add the TLS server block + 80->443 redirect on first cert issue.
server {
    listen 80;
    listen [::]:80;
    server_name DOMAIN www.DOMAIN;

    # Uploads: app's multer cap is 50MB; give headroom.
    client_max_body_size 64M;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/javascript;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;

        # Websocket upgrade — REQUIRED for Socket.io.
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Long-lived websockets shouldn't time out at 60s.
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

- [ ] **Step 2: Verify the config is syntactically structured**

```bash
grep -c "proxy_set_header Upgrade" deploy/nginx/moduli.conf
# Expected: 1  (the websocket upgrade header is present)
grep -c "client_max_body_size" deploy/nginx/moduli.conf
# Expected: 1
```

(Full `nginx -t` validation happens on the box in Task 5; the placeholder `DOMAIN` is substituted there.)

- [ ] **Step 3: Commit**

```bash
git add deploy/nginx/moduli.conf
git commit -m "build: add nginx reverse-proxy config for moduli"
```

---

### Task 3: Author the pm2 ecosystem file

Define the pm2 process declaratively so reboots and `deploy.sh` restarts are deterministic. The app must be started with `--env-file=./server/.env` (matching the local `serve` script) and the 4GB heap flag.

**Files:**
- Create: `ecosystem.config.cjs`

**Interfaces:**
- Consumes: `server/server.js`, `server/.env` (on box).
- Produces: pm2 app named `moduli`, started by `provision.sh` and restarted by `deploy.sh`.

- [ ] **Step 1: Write the ecosystem file**

Create `ecosystem.config.cjs` at the repo root:

```js
// pm2 process definition for the Moduli production app.
// Start:  pm2 start ecosystem.config.cjs
// Reload: pm2 restart moduli
module.exports = {
  apps: [
    {
      name: "moduli",
      script: "server/server.js",
      // Match the local `serve` script: load env from server/.env, 4GB heap.
      node_args: "--env-file=./server/.env --max-old-space-size=4096",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "6G",
      env: { NODE_ENV: "production" },
    },
  ],
};
```

- [ ] **Step 2: Verify it parses as valid JS**

```bash
node -e "const c=require('./ecosystem.config.cjs'); console.log(c.apps[0].name, c.apps[0].script)"
# Expected: moduli server/server.js
```

- [ ] **Step 3: Commit**

```bash
git add ecosystem.config.cjs
git commit -m "build: add pm2 ecosystem config (moduli app, env-file + heap flag)"
```

---

### Task 4: Author the one-time provisioning script

`provision.sh` runs ONCE on a fresh box (as root) to bring it from bare Ubuntu to a running, secured app host. It is idempotent where practical so a re-run after a fix doesn't break things.

**Files:**
- Create: `provision.sh`

**Interfaces:**
- Consumes: `SERVER_IP` (where it runs), `DOMAIN`, `REPO_URL`, plus `server/.env` content (pasted in interactively or pre-placed).
- Produces: a `deploy` user, installed toolchain, cloned repo at `/var/www/moduli`, running pm2 app, running Ollama, configured-but-not-yet-TLS Nginx. TLS is issued separately in Task 6.

- [ ] **Step 1: Write the script**

Create `provision.sh`:

```bash
#!/usr/bin/env bash
# provision.sh — one-time setup for a fresh Ubuntu 24.04 (ARM64) box.
# Run as root on the server:  bash provision.sh
set -euo pipefail

# ── Config (edit these three before running) ─────────────────────────────────
DOMAIN="moduli.example.com"
REPO_URL="https://github.com/midnightmastermind/dndtest2.git"
APP_DIR="/var/www/moduli"
DEPLOY_USER="deploy"

echo "==> 1/8  System packages"
apt-get update -y
apt-get install -y curl git nginx ufw

echo "==> 2/8  Node 22 (NodeSource)"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1)" != "v22" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2

echo "==> 3/8  Non-root deploy user"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
  mkdir -p /home/$DEPLOY_USER/.ssh
  # Copy root's authorized key so you can SSH in as deploy.
  cp /root/.ssh/authorized_keys /home/$DEPLOY_USER/.ssh/authorized_keys
  chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh
  chmod 700 /home/$DEPLOY_USER/.ssh
  chmod 600 /home/$DEPLOY_USER/.ssh/authorized_keys
fi

echo "==> 4/8  Firewall (UFW): only 22/80/443"
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

echo "==> 5/8  Ollama (systemd, localhost-bound) + model"
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
ollama pull qwen2.5-coder:7b

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
sudo -u $DEPLOY_USER bash -c "cd $APP_DIR && pm2 start ecosystem.config.cjs && pm2 save"
env PATH="$PATH:/usr/bin" pm2 startup systemd -u $DEPLOY_USER --hp /home/$DEPLOY_USER | tail -1 | bash

echo ""
echo "✅ Provision complete. App should be live on http://$DOMAIN"
echo "   Next: issue TLS  ->  certbot --nginx -d $DOMAIN -d www.$DOMAIN"
echo "   Then seed Atlas  ->  cd $APP_DIR && npm run seed:live"
```

- [ ] **Step 2: Verify the script is valid bash**

```bash
bash -n provision.sh
# Expected: no output (syntax OK)
```

- [ ] **Step 3: Confirm it references the committed artifacts from Tasks 2–3**

```bash
grep -q "deploy/nginx/moduli.conf" provision.sh && grep -q "ecosystem.config.cjs" provision.sh && echo OK
# Expected: OK
```

- [ ] **Step 4: Commit**

```bash
git add provision.sh
git commit -m "build: one-time provisioning script for moduli VPS"
```

---

### Task 5: Run provisioning on the box (gated execution)

Execute the script against the real server. This is the first task that mutates the live box.

**Interfaces:**
- Consumes: `provision.sh`, `server/.env.production.example`, Task 0 facts.
- Produces: a running (HTTP-only) app reachable at `http://DOMAIN`.

- [ ] **Step 1: Push the committed scripts so the box can clone them**

```bash
git push
# Expected: branch pushed to origin (provision.sh, nginx conf, ecosystem, env example all on origin)
```

- [ ] **Step 2: Edit the three config vars at the top of provision.sh on the box**

SSH to the server, get the repo onto it once, and set `DOMAIN` / `REPO_URL` / `APP_DIR`:

```bash
ssh root@SERVER_IP
# on the box:
curl -fsSLO https://raw.githubusercontent.com/midnightmastermind/dndtest2/master/provision.sh
# edit DOMAIN + REPO_URL at the top of provision.sh (use nano/vi)
```

- [ ] **Step 3: First run — it will stop at step 7 asking for server/.env**

```bash
# on the box, as root:
bash provision.sh
# Expected: runs steps 1-6, then EXITS at "No server/.env found" (this is intended)
```

- [ ] **Step 4: Create the real server/.env from the template**

```bash
# on the box:
cd /var/www/moduli
cp server/.env.production.example server/.env
# fill in MONGO_URI; set secrets:
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" server/.env
sed -i "s|^ASSISTANT_API_TOKEN=.*|ASSISTANT_API_TOKEN=$(openssl rand -hex 24)|" server/.env
# then edit MONGO_URI by hand (paste the Atlas SRV string)
nano server/.env
chown deploy:deploy server/.env
```

- [ ] **Step 5: Re-run provisioning to finish steps 7–8**

```bash
# on the box, as root:
bash provision.sh
# Expected: completes through "✅ Provision complete"
```

- [ ] **Step 6: Verification gate — app answers on localhost and through Nginx**

```bash
# on the box:
curl -s localhost:5000/health
# Expected JSON: {"ok":true,"db":"ok",...}

pm2 list
# Expected: a process named "moduli" with status "online"

systemctl is-active ollama
# Expected: active
```

```bash
# from your laptop:
curl -s http://DOMAIN/health
# Expected JSON: {"ok":true,"db":"ok",...}
```

If `db` is `disconnected`, the Atlas IP allowlist or `MONGO_URI` is wrong — fix before continuing.

---

### Task 6: Issue the TLS certificate

Turn on HTTPS. Certbot edits the Nginx config in place to add the 443 server block and the 80→443 redirect.

**Interfaces:**
- Consumes: running HTTP site from Task 5, `DOMAIN`.
- Produces: a valid Let's Encrypt cert + auto-renew timer; site reachable on `https://DOMAIN`.

- [ ] **Step 1: Install Certbot and issue the cert**

```bash
# on the box, as root:
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d DOMAIN -d www.DOMAIN --non-interactive --agree-tos -m you@example.com --redirect
# Expected: "Congratulations! ... certificate ... deployed"
```

- [ ] **Step 2: Verify auto-renewal is armed**

```bash
systemctl status certbot.timer --no-pager | grep Active
# Expected: "Active: active (waiting)"
certbot renew --dry-run
# Expected: ends with "Congratulations, all simulated renewals succeeded"
```

- [ ] **Step 3: Verification gate — HTTPS works and HTTP redirects**

```bash
# from your laptop:
curl -sI http://DOMAIN/health | grep -i location
# Expected: Location: https://DOMAIN/health  (301/302 redirect)

curl -s https://DOMAIN/health
# Expected JSON: {"ok":true,"db":"ok",...}
```

---

### Task 7: Adapt deploy.sh for the new server

Repoint the existing LAN deploy script at the production box, switch to SSH keys (no password prompt), use the `deploy` user, and restart via the ecosystem file.

**Files:**
- Modify: `deploy.sh`

**Interfaces:**
- Consumes: `SERVER_IP`/`DOMAIN`, `deploy` user, SSH key, `/var/www/moduli`, `ecosystem.config.cjs`.
- Produces: a one-command `./deploy.sh "msg"` ongoing deploy.

- [ ] **Step 1: Update the host, dir, and restart line**

In `deploy.sh`, change the header constants:

```bash
# Server: <DOMAIN> (deploy@) | /var/www/moduli  [SSH keys]
REMOTE_HOST="deploy@DOMAIN"
REMOTE_DIR="/var/www/moduli"
```

Replace the remote pm2 restart line so it uses the ecosystem file (start-or-restart in one shot):

```bash
  echo '  → Restarting server (pm2)...'
  pm2 restart moduli || pm2 start ecosystem.config.cjs
  pm2 save
```

And remove the now-incorrect password prompt note:

```bash
echo "🚀 Deploying to $REMOTE_HOST:$REMOTE_DIR ..."
```

(Delete the line that says `(You will be prompted for the password)` — SSH keys mean no prompt.)

- [ ] **Step 2: Verify the script still parses and points at prod**

```bash
bash -n deploy.sh
# Expected: no output (syntax OK)
grep -E "REMOTE_HOST|ecosystem.config.cjs" deploy.sh
# Expected: REMOTE_HOST="deploy@DOMAIN" and the ecosystem fallback line present
```

- [ ] **Step 3: Commit**

```bash
git add deploy.sh
git commit -m "build: point deploy.sh at production VPS (deploy user, ssh keys, ecosystem restart)"
```

---

### Task 8: First data seed + full end-to-end smoke test

Seed the Atlas database once and verify the real app works in a browser, including websockets, login, and the assistant.

**Interfaces:**
- Consumes: everything above.
- Produces: a verified-live deployment.

- [ ] **Step 1: Seed Atlas (once)**

```bash
# on the box:
cd /var/www/moduli
npm run seed:live
# Expected: createLiveData runs to completion against Atlas without connection errors
```

- [ ] **Step 2: Verification gate — DB now has a grid**

```bash
curl -s https://DOMAIN/health
# Expected: {"ok":true,"db":"ok","gridCount":>=1,...}  (gridCount is no longer 0/null)
```

- [ ] **Step 3: Browser smoke test (manual)**

Open `https://DOMAIN` in a browser and confirm:
- App loads over HTTPS with a valid padlock (no cert warning).
- Log in succeeds (JWT signed with the strong secret).
- Open DevTools → Network → WS: a Socket.io websocket connection shows status **101 / connected** (proves Nginx upgrade headers work).
- Drag a card / edit a field → change persists after reload (Atlas write path works).
- Upload an image → it displays and survives reload (disk uploads work).
- Open the AI assistant drawer → ask it something → it responds (Ollama path works).

- [ ] **Step 4: Verify a redeploy round-trips**

```bash
# from your laptop, make a trivial change and:
./deploy.sh "deploy: smoke test redeploy"
# Expected: build → push → ssh → pull → install → "pm2 ... online" → "Deployment finished!"
curl -s https://DOMAIN/health
# Expected: still {"ok":true,...} after restart
```

- [ ] **Step 5: Update the spec status**

Mark the design spec as implemented:

```bash
# Edit docs/superpowers/specs/2026-06-19-deploy-moduli-to-public-server-design.md
# Change "Status: Approved (design); implementation plan pending"
#     to "Status: Implemented YYYY-MM-DD (see plans/2026-06-20-deploy-moduli-to-public-server.md)"
git add docs/superpowers/specs/2026-06-19-deploy-moduli-to-public-server-design.md
git commit -m "docs: mark deploy spec implemented"
```

---

## Verification summary (the gates, in order)

| Task | Gate |
|------|------|
| 0 | `dig DOMAIN` → SERVER_IP; SSH as root works |
| 1 | `.env.production.example` has only placeholders; `server/.env` gitignored |
| 2 | nginx conf has Upgrade header + body-size limit |
| 3 | `ecosystem.config.cjs` requires cleanly |
| 4 | `bash -n provision.sh` clean; references committed artifacts |
| 5 | `/health` → `{"ok":true,"db":"ok"}` via localhost AND `http://DOMAIN`; pm2 online; ollama active |
| 6 | `https://DOMAIN/health` works; HTTP 301→HTTPS; `certbot renew --dry-run` succeeds |
| 7 | `deploy.sh` parses; points at `deploy@DOMAIN` |
| 8 | `gridCount>=1`; browser: HTTPS + login + WS 101 + persist + upload + assistant; redeploy round-trips |

## Out of scope (deferred — per spec)

- S3-style object storage for uploads.
- Cloudflare CDN/proxy.
- Multi-server scaling / load balancing.
- Tightening CORS from `*` to the specific domain (safe to defer because Nginx serves same-origin).
- `fail2ban` (optional hardening).
- **Backups** (post-launch ops, not a go-live blocker): Atlas auto-backs the DB; enable Hetzner snapshots in the console and add a weekly `cron` `rsync` of `server/uploads` to offsite. Do this once the app is verified live.
