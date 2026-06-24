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
      env: { NODE_ENV: "production" },
    },
  ],
};
