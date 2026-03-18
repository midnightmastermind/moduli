// playwright.config.js — E2E test config
// Usage:
//   1. Start the app:  npm run dev        (client on :3000, server on :5000)
//   2. Run tests:      npx playwright test
//   3. Create test user (once): cd server && node scripts/resetData.js
//
// Auth: setup project logs in as test@moduli.test via Socket.io and saves auth state.
// Playwright reuses existing dev server if already running (reuseExistingServer: true).
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

const AUTH_STATE = path.join(__dirname, 'tests/e2e/.auth/state.json');

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: ['**/*.spec.js'],
  fullyParallel: false,   // serial while debugging — change to true for speed
  retries: 1,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/html' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  // Auto-start Vite dev client if not already running.
  // NOTE: socket.io server must ALSO be running (npm run start:server / npm run dev).
  webServer: {
    command: 'npm run dev:client',
    url: 'http://localhost:3000',
    reuseExistingServer: true,   // use existing npm run dev session if open
    timeout: 30000,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.js/,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: AUTH_STATE },
      dependencies: ['setup'],
    },
  ],
});
