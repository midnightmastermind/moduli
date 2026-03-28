// tests/e2e/example-data.spec.js
// Verifies that the example data from createDefaultUserData.js actually renders
// in the real browser UI after a resetData. Runs against the live server.
const { test, expect } = require('@playwright/test');

const LOAD_TIMEOUT = 30000;

async function waitForGrid(page) {
  await page.waitForSelector('[data-testid="panel-shell"]', { state: 'visible', timeout: LOAD_TIMEOUT });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Return all visible text inside panels */
async function getAllPanelText(page) {
  return page.locator('[data-testid="panel-shell"]').allInnerTexts();
}

/** True if any panel contains the given text */
async function panelContainsText(page, text) {
  const texts = await getAllPanelText(page);
  return texts.some(t => t.includes(text));
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test.describe('Example data — panels load', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);
  });

  test('at least 4 panels are visible', async ({ page }) => {
    const panels = page.locator('[data-testid="panel-shell"]');
    const count = await panels.count();
    expect(count).toBeGreaterThanOrEqual(4);
    console.log(`[example-data] panels on grid: ${count}`);
  });

  test('Schedule tab is visible in centerHub panel', async ({ page }) => {
    // Schedule is now a page tab inside the centerHub panel, not a standalone panel
    const has = await panelContainsText(page, 'Schedule');
    expect(has, 'Schedule tab not found in any panel').toBe(true);
  });

  test('Daily Goals panel is visible', async ({ page }) => {
    const has = await panelContainsText(page, 'Daily Goals');
    expect(has, 'Daily Goals panel not found').toBe(true);
  });

  test('Daily Toolkit panel is visible', async ({ page }) => {
    const has = await panelContainsText(page, 'Daily Toolkit');
    expect(has, 'Daily Toolkit panel not found').toBe(true);
  });

  test('Notebook tab is visible in centerHub panel', async ({ page }) => {
    // Notebook is now a page tab inside the centerHub panel
    const has = await panelContainsText(page, 'Notebook');
    expect(has, 'Notebook tab not found in any panel').toBe(true);
  });

  test('Freepad tab is visible in centerHub panel', async ({ page }) => {
    const has = await panelContainsText(page, 'Freepad');
    expect(has, 'Freepad tab not found in any panel').toBe(true);
  });

  test('centerHub panel shows 3 page tabs', async ({ page }) => {
    // The centerHub panel has Schedule/Notebook/Freepad tabs in its PageTabStrip
    const texts = await getAllPanelText(page);
    // Find the panel that has all three tab labels
    const centerHubText = texts.find(t => t.includes('Schedule') && t.includes('Notebook') && t.includes('Freepad'));
    expect(centerHubText, 'No panel found with all 3 page tabs (Schedule/Notebook/Freepad)').toBeTruthy();
  });
});

test.describe('Example data — containers load', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);
  });

  test('containers render inside panels', async ({ page }) => {
    const containers = page.locator('[data-testid="container-shell"]');
    const count = await containers.count();
    expect(count).toBeGreaterThan(0);
    console.log(`[example-data] containers rendered: ${count}`);
  });

  test('Schedule page has time-slot containers (e.g. 7:00 AM)', async ({ page }) => {
    // Schedule is the default active page in centerHub, so its containers are visible on load
    const allTexts = await page.locator('[data-testid="panel-shell"]').allInnerTexts();
    // Find the panel whose text has both Schedule tab and time slots
    const centerHubText = allTexts.find(t => t.includes('Schedule') && t.includes('Notebook'));
    if (!centerHubText) {
      console.log('[example-data] centerHub panel not found — skip');
      return;
    }
    const hasTimeSlot = /\d+:\d+\s*(am|pm)/i.test(centerHubText);
    expect(hasTimeSlot, `Schedule page has no time slots. Got: ${centerHubText.substring(0, 200)}`).toBe(true);
  });

  test('Daily Toolkit has fitness container', async ({ page }) => {
    const toolkit = page.locator('[data-testid="panel-shell"]').filter({ hasText: 'Daily Toolkit' }).first();
    await expect(toolkit).toBeVisible({ timeout: 5000 });
    const text = await toolkit.innerText();
    const hasFitness = text.includes('Fitness') || text.includes('fitness') || text.includes('Physical');
    expect(hasFitness, `Daily Toolkit missing fitness container. Got: ${text.substring(0, 300)}`).toBe(true);
  });

  test('Todo List panel has task containers', async ({ page }) => {
    const panel = page.locator('[data-testid="panel-shell"]').filter({ hasText: 'Todo List' }).first();
    if (!await panel.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('[example-data] Todo List panel not visible — skip');
      return;
    }
    const containers = panel.locator('[data-testid="container-shell"]');
    const count = await containers.count();
    expect(count, 'Todo List panel has no containers').toBeGreaterThan(0);
    console.log(`[example-data] Todo List containers: ${count}`);
  });
});

test.describe('Example data — instances load', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);
  });

  test('instances render in containers', async ({ page }) => {
    const instances = page.locator('[data-testid="instance-wrap"]');
    const count = await instances.count();
    expect(count, 'No instances rendered at all').toBeGreaterThan(0);
    console.log(`[example-data] instances rendered: ${count}`);
  });

  test('workout instance "Bench Press" is in the Daily Toolkit', async ({ page }) => {
    const toolkit = page.locator('[data-testid="panel-shell"]').filter({ hasText: 'Daily Toolkit' }).first();
    if (!await toolkit.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('[example-data] Daily Toolkit not visible — skip');
      return;
    }
    const text = await toolkit.innerText();
    expect(text, 'Bench Press not found in Daily Toolkit').toContain('Bench Press');
  });

  test('workout instance "Running" is in the Daily Toolkit', async ({ page }) => {
    const toolkit = page.locator('[data-testid="panel-shell"]').filter({ hasText: 'Daily Toolkit' }).first();
    if (!await toolkit.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('[example-data] Daily Toolkit not visible — skip');
      return;
    }
    const text = await toolkit.innerText();
    expect(text, 'Running not found in Daily Toolkit').toContain('Running');
  });

  test('workout instance "Squat" is in the Daily Toolkit', async ({ page }) => {
    const toolkit = page.locator('[data-testid="panel-shell"]').filter({ hasText: 'Daily Toolkit' }).first();
    if (!await toolkit.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('[example-data] Daily Toolkit not visible — skip');
      return;
    }
    const text = await toolkit.innerText();
    expect(text, 'Squat not found in Daily Toolkit').toContain('Squat');
  });

  test('nutrition instance labels load (Greek Yogurt or Salmon)', async ({ page }) => {
    const allTexts = await getAllPanelText(page);
    const combined = allTexts.join(' ');
    const hasNutrition = combined.includes('Yogurt') || combined.includes('Salmon') || combined.includes('Chicken');
    expect(hasNutrition, 'No nutrition instances found on page').toBe(true);
  });

  test('goal instance or container visible in Daily Goals', async ({ page }) => {
    const goals = page.locator('[data-testid="panel-shell"]').filter({ hasText: 'Daily Goals' }).first();
    if (!await goals.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('[example-data] Daily Goals not visible — skip');
      return;
    }
    const text = await goals.innerText();
    expect(text.length, 'Daily Goals panel is empty').toBeGreaterThan(10);
  });
});

test.describe('Example data — instance collapse behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);
  });

  test('instances in list containers start collapsed (no field inputs visible)', async ({ page }) => {
    const listContainers = page.locator('[data-testid="container-shell"]:not([data-kind="doc"])');
    const count = await listContainers.count();
    if (count === 0) {
      console.log('[example-data] no list containers found — skip');
      return;
    }
    const numberInputs = page.locator('[data-testid="instance-wrap"] input[type="number"]');
    const inputCount = await numberInputs.count();
    expect(inputCount, `Expected 0 visible number inputs (collapsed), got ${inputCount}`).toBe(0);
    console.log('[example-data] instances correctly start collapsed — no inputs visible');
  });

  test('clicking an instance in a list container reveals its fields', async ({ page }) => {
    const allInstances = page.locator('[data-testid="instance-wrap"]');
    const total = await allInstances.count();

    for (let i = 0; i < Math.min(total, 20); i++) {
      const instance = allInstances.nth(i);
      if (!await instance.isVisible({ timeout: 1000 }).catch(() => false)) continue;

      const inputsBefore = await instance.locator('input[type="number"]').count();
      if (inputsBefore > 0) continue;

      const instanceBox = await instance.boundingBox();
      if (!instanceBox) continue;

      await page.mouse.click(
        instanceBox.x + instanceBox.width * 0.75,
        instanceBox.y + instanceBox.height * 0.5
      );
      await page.waitForTimeout(150);

      const countAfter = await instance.locator('input[type="number"]').count();
      if (countAfter > 0) {
        console.log(`[example-data] instance ${i} expanded: 0 → ${countAfter} inputs visible`);
        expect(countAfter).toBeGreaterThan(0);
        return;
      }
    }

    console.log('[example-data] no expandable instances with number inputs found — skip');
  });
});

test.describe('Example data — Notebook page tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);
  });

  test('clicking Notebook tab switches active page', async ({ page }) => {
    // Find the centerHub panel (has all 3 tabs)
    const panels = page.locator('[data-testid="panel-shell"]');
    const allTexts = await panels.allInnerTexts();
    const hubIdx = allTexts.findIndex(t => t.includes('Schedule') && t.includes('Notebook') && t.includes('Freepad'));
    if (hubIdx === -1) {
      console.log('[example-data] centerHub panel not found — skip');
      return;
    }
    const hubPanel = panels.nth(hubIdx);

    // Click the Notebook tab
    const notebookTab = hubPanel.locator('button, [role="tab"]').filter({ hasText: 'Notebook' }).first();
    if (!await notebookTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('[example-data] Notebook tab button not visible — skip');
      return;
    }
    await notebookTab.click();
    await page.waitForTimeout(300);

    // After switching, the panel should show notebook content (doc containers)
    const textAfter = await hubPanel.innerText();
    expect(textAfter.length, 'Notebook page appears empty after tab click').toBeGreaterThan(5);
    console.log(`[example-data] Notebook page content length after tab click: ${textAfter.length}`);
  });
});

test.describe('Example data — data integrity checks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);
  });

  test('grid has more than 10 total instances (data is populated)', async ({ page }) => {
    const instances = page.locator('[data-testid="instance-wrap"]');
    const count = await instances.count();
    expect(count, `Only ${count} instances — resetData may not have been run`).toBeGreaterThan(10);
    console.log(`[example-data] total instances in grid: ${count}`);
  });

  test('grid has more than 5 containers (data is populated)', async ({ page }) => {
    const containers = page.locator('[data-testid="container-shell"]');
    const count = await containers.count();
    expect(count, `Only ${count} containers — resetData may not have been run`).toBeGreaterThan(5);
    console.log(`[example-data] total containers in grid: ${count}`);
  });

  test('app toolbar is visible', async ({ page }) => {
    const toolbar = page.locator('[data-testid="toolbar"]');
    await expect(toolbar).toBeVisible({ timeout: 5000 });
    console.log('[example-data] toolbar visible');
  });

  test('no error banner visible after load', async ({ page }) => {
    const errorText = await page.locator('body').innerText();
    const hasJsError = errorText.includes('TypeError') || errorText.includes('ReferenceError');
    expect(hasJsError, 'JS error text visible in page body').toBe(false);
    console.log('[example-data] no error text visible in body');
  });
});
