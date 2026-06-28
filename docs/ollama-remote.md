# Connecting the server to a home Ollama (Option B — Cloudflare Tunnel)

The production box can't run Ollama, so the assistant points at an Ollama running
on a home machine, reached over a Cloudflare Tunnel. Ollama has **no auth of its
own**, so the tunnel is protected with a Cloudflare Access **service token** and
the server sends that token on every request.

## Home machine (where Ollama runs)

1. Pull a tool-capable model: `ollama pull qwen2.5-coder:7b` (or similar).
2. Make Ollama listen on all interfaces (default is localhost-only):
   ```bash
   # set this in the environment the ollama service runs under, then restart it
   OLLAMA_HOST=0.0.0.0:11434 ollama serve
   ```
3. Install `cloudflared` and create a tunnel that routes a hostname to it, e.g.
   `ollama.viafluere.com → http://localhost:11434`.
4. In the Cloudflare Zero Trust dashboard:
   - Add an **Access** application protecting `ollama.viafluere.com`.
   - Create a **service token** (gives you a Client ID + Client Secret).
   - Add an Access policy that allows that service token (and nothing else).

## Server (`server/.env`)

```
OLLAMA_URL=https://ollama.viafluere.com
OLLAMA_MODEL=qwen2.5-coder:7b
CF_ACCESS_CLIENT_ID=<service token client id>.access
CF_ACCESS_CLIENT_SECRET=<service token client secret>
```

The backend is already forced to Ollama via `ecosystem.config.cjs`
(`ASSISTANT_BACKEND=ollama`), so `ANTHROPIC_API_KEY` is ignored for now. To go
back to Claude later, remove that env line and restart.

`server/services/assistantAgent.js` reads `CF_ACCESS_CLIENT_ID` /
`CF_ACCESS_CLIENT_SECRET` and attaches them as `CF-Access-Client-Id` /
`CF-Access-Client-Secret` headers on every Ollama request (probe + chat). A
generic `OLLAMA_AUTH_HEADER="Header-Name: value"` is also supported if you front
it differently.

Restart: `pm2 restart moduli`.

## Notes
- The home machine must stay on with Ollama + cloudflared running.
- Speed = server→home round-trip + home **upload** bandwidth + model latency on
  your hardware. Responses stream, so it's usable; pick a smaller model if slow.
- Alternative (Option A): Tailscale mesh — set `OLLAMA_URL=http://<tailscale-ip>:11434`,
  no Access token needed (private network).
