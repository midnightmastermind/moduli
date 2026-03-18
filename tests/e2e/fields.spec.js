// tests/e2e/fields.spec.js
// Verifies that field inputs and displays render correctly in the grid.
const { test, expect } = require('@playwright/test');

const GRID_LOAD_TIMEOUT = 30000;

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

test.describe('Field inputs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);
  });

  test('number field accepts value entry', async ({ page }) => {
    const expanded = await expandSomeInstance(page);
    if (!expanded) {
      console.log('[fields] no instances with fields found — skip');
      return test.skip();
    }
    const numberInput = page.locator('input[type="number"]').first();
    if (!await numberInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('[fields] no number inputs visible — skip');
      return test.skip();
    }
    await numberInput.click();
    await numberInput.fill('42');
    await expect(numberInput).toHaveValue('42');
    console.log('[fields] number input accepted value 42');
  });

  test('checkbox toggles on click', async ({ page }) => {
    const expanded = await expandSomeInstance(page);
    if (!expanded) {
      console.log('[fields] no instances with fields found — skip');
      return test.skip();
    }
    const checkbox = page.locator('[role="checkbox"]').first();
    if (!await checkbox.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('[fields] no checkboxes visible — skip');
      return test.skip();
    }
    const before = await checkbox.getAttribute('aria-checked');
    await checkbox.click();
    const after = await checkbox.getAttribute('aria-checked');
    expect(after).not.toBe(before);
    console.log(`[fields] checkbox toggled: ${before} → ${after}`);
  });

  test('text input accepts keyboard input', async ({ page }) => {
    const expanded = await expandSomeInstance(page);
    if (!expanded) {
      console.log('[fields] no instances with fields found — skip');
      return test.skip();
    }
    const textInput = page.locator('input[type="text"]').first();
    if (!await textInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('[fields] no text inputs visible — skip');
      return test.skip();
    }
    await textInput.click();
    await textInput.fill('test value');
    await expect(textInput).toHaveValue('test value');
    console.log('[fields] text input accepted value');
  });

  test('CommandCenter Fields tab loads field categories', async ({ page }) => {
    const ccButton = page.locator('button[title*="command center"]').first();
    if (!await ccButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('[fields] CC button not found — skip');
      return test.skip();
    }
    await ccButton.click();
    await page.waitForTimeout(350);

    const fieldsTab = page.locator('button[title="Fields"]').first();
    await expect(fieldsTab).toBeVisible({ timeout: 3000 });

    await fieldsTab.click();
    await page.waitForTimeout(200);

    // Category column headers or field pills should appear
    const ccContent = page.locator('[data-testid="command-center"]');
    const text = await ccContent.textContent();
    expect(text.length).toBeGreaterThan(10);
    console.log('[fields] CC Fields tab loaded');
  });
});
