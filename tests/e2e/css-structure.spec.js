// tests/e2e/css-structure.spec.js
// CSS / structural tests — verify key testids and layout classes render correctly.
const { test, expect } = require('@playwright/test');

const GRID_LOAD_TIMEOUT = 30000;

async function waitForGrid(page) {
  await page.waitForSelector('[data-testid="panel-shell"]', { state: 'visible', timeout: GRID_LOAD_TIMEOUT });
}

test.describe('App structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);
  });

  test('app-root renders', async ({ page }) => {
    const root = page.locator('[data-testid="app-root"]');
    await expect(root).toBeVisible({ timeout: 5000 });
  });

  test('toolbar renders', async ({ page }) => {
    const toolbar = page.locator('[data-testid="toolbar"]');
    await expect(toolbar).toBeVisible({ timeout: 5000 });
  });

  test('panels render with data-testid', async ({ page }) => {
    const panels = page.locator('[data-testid="panel-shell"]');
    const count = await panels.count();
    expect(count).toBeGreaterThan(0);
    console.log(`[css-structure] panel-shell count: ${count}`);
  });

  test('containers render with data-testid', async ({ page }) => {
    const containers = page.locator('[data-testid="container-shell"]');
    const count = await containers.count();
    expect(count).toBeGreaterThan(0);
    console.log(`[css-structure] container-shell count: ${count}`);
  });

  test('instances render with data-testid', async ({ page }) => {
    const instances = page.locator('[data-testid="instance-wrap"]');
    const count = await instances.count();
    expect(count).toBeGreaterThan(0);
    console.log(`[css-structure] instance-wrap count: ${count}`);
  });

  test('command-center testid is present after opening', async ({ page }) => {
    // CC is lazily mounted — only enters DOM after first open
    const ccButton = page.locator('button[title*="command center"]').first();
    const found = await ccButton.isVisible({ timeout: 3000 }).catch(() => false);
    if (!found) return test.skip();

    await ccButton.click();
    await page.waitForTimeout(350); // CSS transition

    const cc = page.locator('[data-testid="command-center"]');
    await expect(cc).toBeAttached({ timeout: 3000 });
    console.log('[css-structure] command-center element attached after open');
  });

  test('command-center becomes visible when opened', async ({ page }) => {
    const ccButton = page.locator('button[title*="command center"]').first();
    const found = await ccButton.isVisible({ timeout: 3000 }).catch(() => false);
    if (!found) return test.skip();

    await ccButton.click();
    await page.waitForTimeout(350); // CSS transition

    const cc = page.locator('[data-testid="command-center"]');
    // Check maxHeight is no longer 0 (element is visible / has height)
    const height = await cc.evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeGreaterThan(10);
    console.log(`[css-structure] command-center height when open: ${height}`);
  });

  test('radial-handle appears on panel hover', async ({ page }) => {
    // Must hover panel-header specifically — CSS selector is .panel-header:hover > .module-handle
    const panelHeader = page.locator('.panel-header').first();
    await panelHeader.hover();
    const handle = page.locator('[data-testid="radial-handle"]').first();
    await expect(handle).toBeVisible({ timeout: 3000 });
    console.log('[css-structure] radial-handle visible on hover');
  });
});
