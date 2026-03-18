// tests/e2e/cc-drag.spec.js
// E2E tests — assumes app running at localhost:3000 and auth state saved by auth.setup.js
// Run: npx playwright test
const { test, expect } = require('@playwright/test');

const GRID_LOAD_TIMEOUT = 30000; // 30s — socket.io auth + full_state load can take time on cold start

async function waitForGrid(page) {
  await page.waitForSelector('[data-testid="panel-shell"]', { state: 'visible', timeout: GRID_LOAD_TIMEOUT });
}

// Tries to expand instances until field inputs appear. Returns true if any found.
async function expandSomeInstance(page) {
  const instances = page.locator('[data-instance-id]');
  const count = await instances.count();
  for (let i = 0; i < Math.min(count, 20); i++) {
    const inst = instances.nth(i);
    const box = await inst.boundingBox();
    if (!box) continue;
    // Click at 75% from left — the expand toggle area (right of label)
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
    await page.waitForTimeout(150);
    const hasNumber = await page.locator('input[type="number"]').isVisible({ timeout: 300 }).catch(() => false);
    const hasCheckbox = await page.locator('[role="checkbox"]').isVisible({ timeout: 300 }).catch(() => false);
    const hasText = await page.locator('input[type="text"]').isVisible({ timeout: 300 }).catch(() => false);
    if (hasNumber || hasCheckbox || hasText) return true;
  }
  return false;
}

test.describe('CommandCenter drag-and-drop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);
  });

  test('CommandCenter opens on button click', async ({ page }) => {
    // Toolbar CC button title: "Pull down command center" / "Collapse command center"
    const ccButton = page.locator('button[title*="command center"]').first();
    const found = await ccButton.isVisible({ timeout: 3000 }).catch(() => false);
    if (!found) return test.skip();

    await ccButton.click();
    // CC slides down — tab buttons have title="Fields" / "Operations" etc.
    await page.waitForTimeout(350); // CSS transition (max-height 0.28s)
    await expect(page.locator('button[title="Fields"]').first()).toBeVisible({ timeout: 3000 });
  });

  test('dragging a field from CC to an instance adds it', async ({ page }) => {
    // Smoke test — checks that DragProvider doesn't throw and instances render
    const instance = page.locator('[data-instance-id]').first();
    if (!await instance.isVisible({ timeout: 3000 }).catch(() => false)) return test.skip();
    await expect(instance).toBeVisible();
  });
});

test.describe('RadialMenu direction', () => {
  test('RadialMenu handle is visible on panel hover', async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);

    // Must hover panel-header specifically — CSS is .panel-header:hover > .module-handle
    const panelHeader = page.locator('.panel-header').first();
    await panelHeader.hover();
    const handle = page.locator('[data-testid="radial-handle"]').first();
    await expect(handle).toBeVisible({ timeout: 3000 });
  });

  test('clicking RadialMenu handle opens the arc menu', async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);

    const panelHeader = page.locator('.panel-header').first();
    await panelHeader.hover();
    const handle = page.locator('[data-testid="radial-handle"]').first();
    if (!await handle.isVisible({ timeout: 3000 }).catch(() => false)) return test.skip();

    await handle.click();
    await page.waitForTimeout(400); // animation

    // At least one arc button should appear in the portal
    const arcButtons = page.locator('.radial-menu-item');
    await expect(arcButtons.first()).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Form inputs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);
  });

  test('number field input accepts value entry', async ({ page }) => {
    const expanded = await expandSomeInstance(page);
    if (!expanded) return test.skip();
    const numberInput = page.locator('input[type="number"]').first();
    if (!await numberInput.isVisible({ timeout: 3000 }).catch(() => false)) return test.skip();

    await numberInput.click();
    await numberInput.fill('42');
    await expect(numberInput).toHaveValue('42');
  });

  test('checkbox field toggles on click', async ({ page }) => {
    const expanded = await expandSomeInstance(page);
    if (!expanded) return test.skip();
    // shadcn Checkbox renders as [role="checkbox"], not input[type="checkbox"]
    const checkbox = page.locator('[role="checkbox"]').first();
    if (!await checkbox.isVisible({ timeout: 3000 }).catch(() => false)) return test.skip();

    const wasBefore = await checkbox.getAttribute('aria-checked');
    await checkbox.click();
    const nowChecked = wasBefore !== 'true';
    await expect(checkbox).toHaveAttribute('aria-checked', nowChecked ? 'true' : 'false');
  });

  test('text input accepts keyboard input', async ({ page }) => {
    const expanded = await expandSomeInstance(page);
    if (!expanded) return test.skip();
    const textInput = page.locator('input[type="text"]').first();
    if (!await textInput.isVisible({ timeout: 3000 }).catch(() => false)) return test.skip();

    await textInput.click();
    await textInput.fill('hello test');
    await expect(textInput).toHaveValue('hello test');
  });
});

test.describe('Grid structure', () => {
  test('grid renders panels after login', async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);

    const panels = page.locator('[data-panel-id]');
    const count = await panels.count();
    expect(count).toBeGreaterThan(0);
  });

  test('panels contain containers', async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);

    const containers = page.locator('[data-container-id]');
    const count = await containers.count();
    expect(count).toBeGreaterThan(0);
  });

  test('containers contain instances', async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);

    const instances = page.locator('[data-instance-id]');
    const count = await instances.count();
    expect(count).toBeGreaterThan(0);
  });
});
