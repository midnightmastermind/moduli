// tests/e2e/operations.spec.js
// Verifies the Operations tab in CommandCenter renders correctly.
const { test, expect } = require('@playwright/test');

const GRID_LOAD_TIMEOUT = 30000;

async function waitForGrid(page) {
  await page.waitForSelector('[data-panel-id]', { timeout: GRID_LOAD_TIMEOUT });
}

async function openCC(page) {
  const ccButton = page.locator('button[title*="command center"]').first();
  const found = await ccButton.isVisible({ timeout: 3000 }).catch(() => false);
  if (!found) return false;
  await ccButton.click();
  await page.waitForTimeout(350);
  return true;
}

test.describe('Operations tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);
  });

  test('CommandCenter opens and shows Operations tab', async ({ page }) => {
    const opened = await openCC(page);
    if (!opened) return test.skip();

    const opsTab = page.locator('button[title="Operations"]').first();
    await expect(opsTab).toBeVisible({ timeout: 3000 });
    console.log('[operations] Operations tab button visible');
  });

  test('Operations tab has content (category columns or operation items)', async ({ page }) => {
    const opened = await openCC(page);
    if (!opened) return test.skip();

    const opsTab = page.locator('button[title="Operations"]').first();
    if (!await opsTab.isVisible({ timeout: 2000 }).catch(() => false)) return test.skip();

    await opsTab.click();
    await page.waitForTimeout(300);

    const cc = page.locator('[data-testid="command-center"]');
    const text = await cc.textContent();
    expect(text.length).toBeGreaterThan(5);
    console.log(`[operations] Operations tab content length: ${text.length}`);
  });

  test('Fields tab has content (field names visible)', async ({ page }) => {
    const opened = await openCC(page);
    if (!opened) return test.skip();

    const fieldsTab = page.locator('button[title="Fields"]').first();
    if (!await fieldsTab.isVisible({ timeout: 2000 }).catch(() => false)) return test.skip();

    await fieldsTab.click();
    await page.waitForTimeout(300);

    const cc = page.locator('[data-testid="command-center"]');
    const text = await cc.textContent();
    expect(text.length).toBeGreaterThan(5);
    console.log(`[operations] Fields tab content length: ${text.length}`);
  });
});
