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
