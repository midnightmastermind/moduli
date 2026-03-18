// tests/e2e/occurrences.spec.js
// Read-only checks on occurrence state loaded from the server.
// Assumes auth state from auth.setup.js (test user + resetData run).
const { test, expect } = require('@playwright/test');

const GRID_LOAD_TIMEOUT = 30000;

async function waitForGrid(page) {
  await page.waitForSelector('[data-panel-id]', { timeout: GRID_LOAD_TIMEOUT });
}

async function getReduxState(page) {
  // GridActionsContext exposes state on window.__moduli_state__ — if not set, fall back.
  return page.evaluate(() => window.__moduli_state__ || null);
}

test.describe('Occurrence state', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);
  });

  test('grid renders panels — occurrences were loaded', async ({ page }) => {
    const panels = page.locator('[data-panel-id]');
    const count = await panels.count();
    expect(count).toBeGreaterThan(0);
    console.log(`[occurrences] panels loaded: ${count}`);
  });

  test('panels contain containers', async ({ page }) => {
    const containers = page.locator('[data-container-id]');
    const count = await containers.count();
    expect(count).toBeGreaterThan(0);
    console.log(`[occurrences] containers loaded: ${count}`);
  });

  test('containers contain instances', async ({ page }) => {
    const instances = page.locator('[data-instance-id]');
    const count = await instances.count();
    expect(count).toBeGreaterThan(0);
    console.log(`[occurrences] instances loaded: ${count}`);
  });

  test('moduli-gridId is set in localStorage after load', async ({ page }) => {
    const gridId = await page.evaluate(() => localStorage.getItem('moduli-gridId'));
    expect(gridId).toBeTruthy();
    expect(gridId.length).toBeGreaterThan(5);
    console.log(`[occurrences] gridId in localStorage: ${gridId}`);
  });

  test('moduli-userId is set in localStorage', async ({ page }) => {
    const userId = await page.evaluate(() => localStorage.getItem('moduli-userId'));
    expect(userId).toBeTruthy();
    console.log(`[occurrences] userId in localStorage: ${userId}`);
  });

  test('moduli-token is set in localStorage', async ({ page }) => {
    const token = await page.evaluate(() => localStorage.getItem('moduli-token'));
    expect(token).toBeTruthy();
    console.log(`[occurrences] JWT token present: ${token?.substring(0, 20)}…`);
  });
});
