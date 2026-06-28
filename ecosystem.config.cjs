// pm2 process definition for the Moduli production app.
// Start:  pm2 start ecosystem.config.cjs
// Reload: pm2 restart moduli
module.exports = {
  apps: [
    {
      name: "moduli",
      script: "server/server.js",
      // Load env from server/.env. Heap sized for a small (4GB) droplet; bump
      // both numbers if you move to a bigger box.
      node_args: "--env-file=./server/.env --max-old-space-size=1536",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "2G",
      // ASSISTANT_BACKEND=ollama forces the assistant to use the (tunneled) home
      // Ollama and ignore ANTHROPIC_API_KEY for now. Set OLLAMA_URL +
      // CF_ACCESS_CLIENT_ID/SECRET in server/.env (the Cloudflare-tunnel target +
      // service token). Remove this line to go back to auto/Claude.
      env: { NODE_ENV: "production", ASSISTANT_BACKEND: "ollama" },
    },
  ],
};
