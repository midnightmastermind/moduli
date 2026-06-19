# Deploy Moduli to a Public Server — Design

**Date:** 2026-06-19
**Status:** Approved (design); implementation plan pending

## Goal

Publish Moduli to a public, internet-reachable server on a custom domain, cheaply,
while keeping the optional AI assistant (Ollama) working. The app must remain fully
functional: real-time websockets, file uploads, and the AI assistant.

## Constraints & decisions

These were decided during brainstorming:

- **Host:** A single VPS that runs the app *and* Ollama together (all-in-one).
  The user's home machine is not reliably online, so Ollama cannot live there.
- **Database:** MongoDB Atlas free tier (M0, managed, 512MB).
- **AI assistant:** Keep Ollama (`qwen2.5-coder:7b`) running on the same box.
- **Domain registrar:** Dynadot (user already has an account).
- **Budget:** "cheap" — target roughly $15/mo + domain.

## App facts that shape the deployment

- **One Node process** (`server/server.js`, Express 5 + Socket.io) serves BOTH the
  API/websocket AND the built React client from `client/dist`
  (`server.js:950-953`). No separate frontend host is needed.
- **Listens on `PORT` (default 5000)**, binds `0.0.0.0` (`server.js:959-960`).
- **Websockets** via Socket.io — the reverse proxy MUST pass upgrade headers.
- **Uploads to local disk** at `server/uploads`, served via `/uploads` static mount
  (`server.js:346`), with sha256 sharding + `sharp` thumbnails. Requires a
  PERSISTENT filesystem (rules out ephemeral-disk PaaS without a paid volume).
- **MongoDB** via `MONGO_URI` (Mongoose).
- **AI assistant** (`server/services/assistantAgent.js`):
  - Auto-selects backend: Ollama if reachable, else Anthropic if `ANTHROPIC_API_KEY`,
    else a deterministic fallback. Running Ollama "lights it up" with NO code change.
  - Ollama URL default `http://localhost:11434`, model default `qwen2.5-coder:7b`.
  - Optional `ANTHROPIC_API_KEY` cloud fallback.
- **Security gap to fix in prod:** `JWT_SECRET` defaults to `"SUPER_SECRET"`
  (`server.js:65`, `utils/jwts.js:3`). A strong secret MUST be set in prod, or
  login tokens can be forged.
- **CORS** is currently wide open (`origin: "*"`, `server.js:98,119`). Acceptable
  because Nginx serves same-origin; optional to tighten later.
- **Existing deploy tooling:** `deploy.sh` already does build → git push → ssh →
  pull → npm install → `pm2 restart moduli`. It targets a LAN box
  (`192.168.3.133`) via password SSH. We adapt it to the new server + SSH keys.

## Recommended server

**Hetzner Cloud CAX31** — ARM64, 8 vCPU, **16GB RAM**, 160GB disk, ~€14/mo (~$15),
Ubuntu 24.04 LTS. ARM64 is fully supported by `sharp`, Ollama, and Node 22.

Alternatives (not chosen):
- Hetzner CAX21 (8GB, ~€7.5/mo) — only viable with a smaller model (`qwen2.5-coder:3b`).
- Contabo (24GB ~$15) — more RAM/$ but slower/oversold CPU; Ollama would lag.

## Architecture (single box)

```
Browser ──HTTPS──▶ Nginx (:443, TLS, ws upgrade) ──▶ Node app (pm2, :5000)
   │ DNS via Dynadot                                    ├─▶ MongoDB Atlas (M0, TLS)
   │                                                    ├─▶ Ollama (127.0.0.1:11434)
   └─ websocket upgrade proxied through Nginx           └─▶ ./server/uploads (local disk)
```

## Components & responsibilities

1. **Nginx** — internet-facing on 80/443 only. TLS termination via Let's Encrypt
   (Certbot, auto-renew), reverse-proxy to `localhost:5000`, websocket upgrade
   headers (`Upgrade`/`Connection`), gzip, `client_max_body_size` raised for uploads.
2. **Node 22 + pm2** — runs `server/server.js`; `pm2 startup` + `pm2 save` for
   restart-on-reboot and crash recovery. App name `moduli` (matches `deploy.sh`).
3. **Ollama** — systemd service bound to `127.0.0.1` only; `qwen2.5-coder:7b`
   pulled once. App reaches it at the default URL; no code change.
4. **MongoDB Atlas (M0 free)** — server's public IP whitelisted; SRV string in
   `MONGO_URI`. 512MB cap; uploads are on disk (not Mongo), so DB stays small.
5. **Disk uploads** — `server/uploads` on the 160GB volume; included in backups.
6. **UFW firewall** — allow 22/80/443 only; Ollama and Node stay internal.

## Domain / DNS (Dynadot)

A-records `@` and `www` → server public IP. Certbot issues a cert for
`yourdomain.com` + `www`. Optional later: put Cloudflare proxy in front for CDN/DDoS.

## Production config (`server/.env` on the box — NOT committed)

| Var | Value |
|-----|-------|
| `MONGO_URI` | Atlas SRV connection string |
| `PORT` | `5000` |
| `JWT_SECRET` | strong random (e.g. `openssl rand -hex 32`) — **critical** |
| `OLLAMA_MODEL` | `qwen2.5-coder:7b` |
| `ASSISTANT_API_TOKEN` | random token |
| `ANTHROPIC_API_KEY` | optional cloud fallback |

## Deploy flow

- **One-time `provision.sh`** for initial box setup: create non-root `deploy` user,
  SSH-keys-only, install Node 22 + pm2 + Nginx + Certbot + Ollama, UFW rules, clone
  repo, write `server/.env`, pull the Ollama model, build client, seed Atlas, start
  via pm2, issue TLS cert.
- **Ongoing `deploy.sh`** (adapt existing): point `REMOTE_HOST`/`REMOTE_DIR` at the
  new server, switch to SSH keys, keep build → push → pull → npm install →
  `pm2 restart moduli`.
- **First-boot data:** run the live seed (`npm run seed:live`) once against Atlas.

## Security hardening (in provisioning)

Non-root `deploy` user, SSH-keys-only (password auth off), UFW, strong `JWT_SECRET`,
Ollama localhost-bound, automatic cert renewal. Optional: fail2ban.

## Backups

Atlas auto-backs the DB. Hetzner snapshots (cheap) + a weekly `rsync` of
`server/uploads` cover the disk.

## Cost

Server ~$15/mo + Dynadot domain (~$10–15/yr) + Atlas free = **~$15/mo + domain.**

## Out of scope (for now)

- Migrating uploads to S3-style object storage (would enable ephemeral-disk PaaS).
- Cloudflare CDN/proxy layer.
- Multi-server scaling / load balancing.
- Tightening CORS to the specific domain.
