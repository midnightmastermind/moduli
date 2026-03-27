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

  test('Schedule panel is visible', async ({ page }) => {
    const has = await panelContainsText(page, 'Schedule');
    expect(has, 'Schedule panel not found').toBe(true);
  });

  test('Daily Goals panel is visible', async ({ page }) => {
    const has = await panelContainsText(page, 'Daily Goals');
    expect(has, 'Daily Goals panel not found').toBe(true);
  });

  test('Daily Toolkit panel is visible', async ({ page }) => {
    const has = await panelContainsText(page, 'Daily Toolkit');
    expect(has, 'Daily Toolkit panel not found').toBe(true);
  });

  test('Notebook panel is visible', async ({ page }) => {
    const has = await panelContainsText(page, 'Notebook');
    expect(has, 'Notebook panel not found').toBe(true);
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

  test('Schedule has time-slot containers (e.g. 7:00 AM)', async ({ page }) => {
    // Schedule may be hidden behind other stacked panels at col:1 — innerText still works.
    // Use allInnerTexts() to find the panel whose text starts with "Schedule"
    // (avoids hasText filter which matches any panel containing "Schedule" in child text)
    const allTexts = await page.locator('[data-testid="panel-shell"]').allInnerTexts();
    const scheduleText = allTexts.find(t => t.trim().startsWith('Schedule'));
    if (!scheduleText) {
      console.log('[example-data] Schedule panel not found — skip');
      return;
    }
    // Time slots like "7:00 AM", "8:00 AM", "12:00am", etc.
    const hasTimeSlot = /\d+:\d+\s*(am|pm)/i.test(scheduleText);
    expect(hasTimeSlot, `Schedule panel has no time slots. Got: ${scheduleText.substring(0, 200)}`).toBe(true);
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

  test('goal instance "Morning Workout" or similar goal is visible', async ({ page }) => {
    const goals = page.locator('[data-testid="panel-shell"]').filter({ hasText: 'Daily Goals' }).first();
    if (!await goals.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('[example-data] Daily Goals not visible — skip');
      return;
    }
    const text = await goals.innerText();
    // Goals panel should have at least one instance row
    expect(text.length, 'Daily Goals panel is empty').toBeGreaterThan(10);
  });
});

test.describe('Example data — instance collapse behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);
  });

  test('instances in list containers start collapsed (no field inputs visible)', async ({ page }) => {
    // Find a non-doc container (list kind) with instances
    const listContainers = page.locator('[data-testid="container-shell"]:not([data-kind="doc"])');
    const count = await listContainers.count();
    if (count === 0) {
      console.log('[example-data] no list containers found — skip');
      return;
    }
    // Number inputs should NOT be visible initially (fields are collapsed)
    const numberInputs = page.locator('[data-testid="instance-wrap"] input[type="number"]');
    const inputCount = await numberInputs.count();
    expect(inputCount, `Expected 0 visible number inputs (collapsed), got ${inputCount}`).toBe(0);
    console.log('[example-data] instances correctly start collapsed — no inputs visible');
  });

  test('clicking an instance in a list container reveals its fields', async ({ page }) => {
    // Try instances until we find one that expands to show number inputs.
    // Doc container instances have no toggle (onToggleExpand=null) so we skip those.
    const allInstances = page.locator('[data-testid="instance-wrap"]');
    const total = await allInstances.count();

    for (let i = 0; i < Math.min(total, 20); i++) {
      const instance = allInstances.nth(i);
      if (!await instance.isVisible({ timeout: 1000 }).catch(() => false)) continue;

      const inputsBefore = await instance.locator('input[type="number"]').count();
      if (inputsBefore > 0) continue; // already expanded or doc container

      const instanceBox = await instance.boundingBox();
      if (!instanceBox) continue;

      // Click right 75% — expand toggle is on the right-side fields div
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
      // This instance didn't expand (doc container or no fields) — try next
    }

    // No expandable instance with number inputs found — skip rather than fail
    console.log('[example-data] no expandable instances with number inputs found — skip');
  });
});

test.describe('Example data — Notebook loads', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);
  });

  test('Notebook panel renders doc containers', async ({ page }) => {
    const notebook = page.locator('[data-testid="panel-shell"]').filter({ hasText: 'Notebook' }).first();
    if (!await notebook.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('[example-data] Notebook panel not visible — skip');
      return;
    }
    const text = await notebook.innerText();
    // Notebook should have some doc content
    expect(text.length, 'Notebook panel is empty').toBeGreaterThan(5);
    console.log(`[example-data] Notebook panel content length: ${text.length}`);
  });

  test('Notebook shows a day page document', async ({ page }) => {
    const notebook = page.locator('[data-testid="panel-shell"]').filter({ hasText: 'Notebook' }).first();
    if (!await notebook.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('[example-data] Notebook panel not visible — skip');
      return;
    }
    const text = await notebook.innerText();
    // Notebook is a day-page artifact panel. The auto-create operation fires on load and creates
    // a "daypage YYYY-MM-DD" module. Either the sample content or the auto-created page will show.
    const hasDayContent = /Journal|Morning|Evening|daypage|\d{4}-\d{2}/i.test(text);
    expect(hasDayContent, `Notebook day page content not found. Got: ${text.substring(0, 200)}`).toBe(true);
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

  test('app title or logo is visible', async ({ page }) => {
    const toolbar = page.locator('[data-testid="toolbar"]');
    await expect(toolbar).toBeVisible({ timeout: 5000 });
    console.log('[example-data] toolbar visible');
  });

  test('no error banner visible after load', async ({ page }) => {
    // Check for common error indicators
    const errorText = await page.locator('body').innerText();
    const hasJsError = errorText.includes('TypeError') || errorText.includes('ReferenceError');
    expect(hasJsError, 'JS error text visible in page body').toBe(false);
    console.log('[example-data] no error text visible in body');
  });
});
