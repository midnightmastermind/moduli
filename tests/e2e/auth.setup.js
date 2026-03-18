// tests/e2e/auth.setup.js
// Playwright global setup — logs in as the test user via Socket.io and saves auth state.
// Runs once before all tests (as the 'setup' project in playwright.config.js).
// Test user created by: node server/scripts/resetData.js
const { test: setup } = require('@playwright/test');
const { io } = require('socket.io-client');
const { mkdir } = require('fs/promises');
const path = require('path');

const APP_URL = 'http://localhost:3000';
const TEST_EMAIL = 'test@moduli.test';
const TEST_PASSWORD = 'testpass123';
const AUTH_DIR = path.join(__dirname, '.auth');
const AUTH_STATE_PATH = path.join(AUTH_DIR, 'state.json');

setup('authenticate as test user', async ({ page }) => {
  // Get JWT token + userId via Socket.io login
  const { token, userId } = await new Promise((resolve, reject) => {
    const socket = io(APP_URL, { transports: ['websocket'] });
    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Socket.io login timed out after 10s'));
    }, 10000);

    socket.on('connect', () => {
      socket.emit('login', { email: TEST_EMAIL, password: TEST_PASSWORD });
    });

    socket.on('auth_success', ({ token, userId }) => {
      clearTimeout(timeout);
      socket.disconnect();
      resolve({ token, userId });
    });

    socket.on('auth_error', (msg) => {
      clearTimeout(timeout);
      socket.disconnect();
      reject(new Error(`Auth error: ${msg}\nRun: cd server && node scripts/resetData.js`));
    });

    socket.on('connect_error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Cannot connect to ${APP_URL}: ${err.message}\nIs the server running?`));
    });
  });

  // Set token + userId in localStorage BEFORE page load so socket.js picks them up on init
  await page.goto(APP_URL);
  await page.evaluate(({ t, uid }) => {
    localStorage.setItem('moduli-token', t);
    if (uid) localStorage.setItem('moduli-userId', uid);
  }, { t: token, uid: userId });

  // Reload so socket.js initializes with the token and emits request_full_state
  await page.reload();

  // Wait for full_state to arrive — bindSocketToStore sets moduli-gridId on receipt
  await page.waitForFunction(
    () => !!localStorage.getItem('moduli-gridId'),
    { timeout: 20000 }
  );

  const gridId = await page.evaluate(() => localStorage.getItem('moduli-gridId'));
  console.log(`\n✅ Logged in as ${TEST_EMAIL}. Grid ID: ${gridId}`);

  // Save storage state for all subsequent tests (includes both token + gridId)
  await mkdir(AUTH_DIR, { recursive: true });
  await page.context().storageState({ path: AUTH_STATE_PATH });

  console.log(`✅ Auth state saved (token + gridId).\n`);
});
