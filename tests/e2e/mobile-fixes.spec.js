// tests/e2e/mobile-fixes.spec.js
// ============================================================
// E2E tests for mobile UX fixes. Runs on mobile-chromium project (Pixel 5 viewport).
// Each test.describe maps to one fix from the Mobile Fixes Plan.
//
// To run:  npx playwright test mobile-fixes.spec.js --project=mobile-chromium
// Or all:  npx playwright test mobile-fixes.spec.js
// ============================================================
const { test, expect } = require('@playwright/test');

const GRID_LOAD_TIMEOUT = 30000;

async function waitForGrid(page) {
  await page.waitForSelector('[data-testid="panel-shell"]', { state: 'visible', timeout: GRID_LOAD_TIMEOUT });
}

// Helper: get grid dimensions from exposed window.__moduli_state__
async function getGridDimensions(page) {
  return page.evaluate(() => {
    const s = window.__moduli_state__;
    return { rows: s?.grid?.rows ?? 1, cols: s?.grid?.cols ?? 1 };
  });
}

// ============================================================
// FIX 1: Android split-screen does NOT intercept instance drags
// Verify: touch-action: none is set on drag handle elements via CSS on mobile
// ============================================================
test.describe('Fix 1 — Android split-screen drag interception', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);
  });

  test('instance drag handles have touch-action: none on mobile', async ({ page }) => {
    // The .module-handle elements (drag handles) should have touch-action: none
    // so Android doesn't intercept the gesture for split-screen before JS runs
    const handles = page.locator('[data-testid="instance-wrap"] .module-handle');
    const count = await handles.count();
    expect(count).toBeGreaterThan(0);

    const touchAction = await handles.first().evaluate(el => getComputedStyle(el).touchAction);
    expect(touchAction).toBe('none');
  });

  test('panel drag handles have touch-action: none on mobile', async ({ page }) => {
    const handles = page.locator('.panel-header .module-handle');
    const count = await handles.count();
    expect(count).toBeGreaterThan(0);

    const touchAction = await handles.first().evaluate(el => getComputedStyle(el).touchAction);
    expect(touchAction).toBe('none');
  });

  test('container drag handles have touch-action: none on mobile', async ({ page }) => {
    const handles = page.locator('.container-header .module-handle');
    const count = await handles.count();
    expect(count).toBeGreaterThan(0);

    const touchAction = await handles.first().evaluate(el => getComputedStyle(el).touchAction);
    expect(touchAction).toBe('none');
  });

  test('instance-wrap content area still allows scrolling (touch-action: manipulation)', async ({ page }) => {
    // The instance-wrap itself (not the handle) should allow scroll via manipulation
    const wraps = page.locator('[data-testid="instance-wrap"]');
    const count = await wraps.count();
    expect(count).toBeGreaterThan(0);

    const touchAction = await wraps.first().evaluate(el => el.style.touchAction);
    expect(touchAction).toBe('manipulation');
  });
});

// ============================================================
// FIX 2: Panel stack cycler arrows visible above panels
// Default data: Schedule/Notebook/Freepad share cell → stackCount > 1
// ============================================================
test.describe('Fix 2 — Panel stack cycler arrows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);
  });

  test('grid has cells with multiple stacked panels', async ({ page }) => {
    // Default data has 7 panels in a 2x3 grid — some cells must have stacks
    const state = await page.evaluate(() => {
      const s = window.__moduli_state__;
      const grid = s?.grid;
      const panels = s?.panels || [];
      const occurrencesById = s?.occurrencesById || {};
      // Count panels per cell
      const cellCounts = {};
      for (const p of panels) {
        const occ = Object.values(occurrencesById).find(o => o.targetId === p.id);
        const row = occ?.placement?.row ?? p.row ?? 0;
        const col = occ?.placement?.col ?? p.col ?? 0;
        const key = `${row}-${col}`;
        cellCounts[key] = (cellCounts[key] || 0) + 1;
      }
      const maxStack = Math.max(...Object.values(cellCounts), 0);
      return { panelCount: panels.length, maxStack, cellCounts };
    });

    expect(state.panelCount).toBeGreaterThan(1);
    expect(state.maxStack).toBeGreaterThan(1);
  });

  test('panel-stack-overlay exists in the DOM', async ({ page }) => {
    const overlays = page.locator('.panel-stack-overlay');
    const count = await overlays.count();
    expect(count).toBeGreaterThan(0);
  });

  test('stack overlay renders AFTER all panels in DOM order', async ({ page }) => {
    // The grid container's children: grid-cells first, then panels, then stack overlays
    const result = await page.evaluate(() => {
      // Find the CSS grid container (has gridTemplateColumns style)
      const grids = document.querySelectorAll('[style*="grid-template-columns"]');
      if (grids.length === 0) return { found: false };
      const grid = grids[0];

      let lastPanelIndex = -1;
      let firstOverlayIndex = Infinity;

      Array.from(grid.children).forEach((child, i) => {
        if (child.getAttribute('data-testid') === 'panel-shell') {
          lastPanelIndex = Math.max(lastPanelIndex, i);
        }
        if (child.querySelector('.panel-stack-overlay')) {
          firstOverlayIndex = Math.min(firstOverlayIndex, i);
        }
      });

      return { found: true, lastPanelIndex, firstOverlayIndex };
    });

    expect(result.found).toBe(true);
    expect(result.lastPanelIndex).toBeGreaterThan(-1);
    expect(result.firstOverlayIndex).not.toBe(Infinity);
    // Stack overlay must come AFTER the last panel
    expect(result.firstOverlayIndex).toBeGreaterThan(result.lastPanelIndex);
  });

  test('stack overlay wrapper has z-index: 80 and pointer-events: none', async ({ page }) => {
    const overlay = page.locator('.panel-stack-overlay').first();
    await expect(overlay).toBeVisible();

    const parentStyles = await overlay.evaluate(el => {
      const p = el.parentElement;
      return {
        zIndex: p.style.zIndex,
        pointerEvents: p.style.pointerEvents,
      };
    });

    expect(parentStyles.zIndex).toBe('80');
    expect(parentStyles.pointerEvents).toBe('none');
  });

  test('stack overlay buttons have pointer-events: auto and are clickable', async ({ page }) => {
    const overlay = page.locator('.panel-stack-overlay').first();
    await expect(overlay).toBeVisible();

    // Check pointer-events on the overlay div itself (not wrapper)
    const pe = await overlay.evaluate(el => el.style.pointerEvents);
    expect(pe).toBe('auto');

    // Buttons should exist (prev + next)
    const buttons = overlay.locator('button');
    const btnCount = await buttons.count();
    expect(btnCount).toBe(2);

    // Buttons should have aria-labels
    const prevLabel = await buttons.first().getAttribute('aria-label');
    const nextLabel = await buttons.last().getAttribute('aria-label');
    expect(prevLabel).toBe('Previous panel');
    expect(nextLabel).toBe('Next panel');
  });

  test('clicking next cycles to a different panel', async ({ page }) => {
    const overlay = page.locator('.panel-stack-overlay').first();
    await expect(overlay).toBeVisible();

    // Get the currently visible panel's ID before clicking
    const panelsBefore = await page.evaluate(() => {
      const panels = document.querySelectorAll('[data-testid="panel-shell"]');
      return Array.from(panels).map(p => p.getAttribute('data-panel-id'));
    });

    // Click "Next panel"
    const nextBtn = overlay.locator('button[aria-label="Next panel"]');
    await nextBtn.click();
    await page.waitForTimeout(300);

    // After cycling, the visible panels should have changed
    const panelsAfter = await page.evaluate(() => {
      const panels = document.querySelectorAll('[data-testid="panel-shell"]');
      return Array.from(panels).map(p => p.getAttribute('data-panel-id'));
    });

    // At least one panel should have changed (cycled)
    const changed = panelsBefore.some((id, i) => panelsAfter[i] !== id) ||
                    panelsBefore.length !== panelsAfter.length;
    expect(changed).toBe(true);
  });
});

// ============================================================
// FIX 3: Panel scroll reaches bottom (no double padding)
// ============================================================
test.describe('Fix 3 — Panel scroll not cut off', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);
  });

  test('.panel-content has padding-bottom but .panel-scroll does NOT on mobile', async ({ page }) => {
    // .panel-content should have padding-bottom (48px)
    const panelContent = page.locator('.panel-content').first();
    const contentVisible = await panelContent.isVisible().catch(() => false);
    if (!contentVisible) return;

    const contentPadding = await panelContent.evaluate(el =>
      parseInt(getComputedStyle(el).paddingBottom, 10)
    );
    expect(contentPadding).toBeGreaterThanOrEqual(40);

    // .panel-scroll should NOT have extra padding (was the bug — double padding)
    const panelScroll = page.locator('.panel-scroll').first();
    const scrollExists = await panelScroll.count();
    if (scrollExists === 0) return; // not all panels use .panel-scroll

    const scrollPadding = await panelScroll.evaluate(el =>
      parseInt(getComputedStyle(el).paddingBottom, 10)
    );
    // Should be 0 or minimal — NOT 40+
    expect(scrollPadding).toBeLessThan(40);
  });
});

// ============================================================
// FIX 4: Down lip button visible and tappable
// Default data: 2 rows → down button should show at row 0
// ============================================================
test.describe('Fix 4 — Down lip button', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);
  });

  test('grid has more than 1 row', async ({ page }) => {
    const { rows } = await getGridDimensions(page);
    expect(rows).toBeGreaterThan(1);
  });

  test('down lip button exists in DOM on multi-row grid', async ({ page }) => {
    const downBtn = page.locator('.mobile-lip-btn-down');
    const count = await downBtn.count();
    expect(count).toBe(1);
  });

  test('down lip button is visible', async ({ page }) => {
    const downBtn = page.locator('.mobile-lip-btn-down');
    await expect(downBtn).toBeVisible();
  });

  test('down lip button has adequate size for tapping (>= 20px height)', async ({ page }) => {
    const downBtn = page.locator('.mobile-lip-btn-down');
    const box = await downBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box.height).toBeGreaterThanOrEqual(20);
    expect(box.width).toBeGreaterThanOrEqual(30);
  });

  test('down lip button is within viewport bounds', async ({ page }) => {
    const downBtn = page.locator('.mobile-lip-btn-down');
    const box = await downBtn.boundingBox();
    expect(box).not.toBeNull();

    const viewport = page.viewportSize();
    // Button should be fully within the viewport
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  });

  test('down lip button is not covered by another element', async ({ page }) => {
    const downBtn = page.locator('.mobile-lip-btn-down');
    const box = await downBtn.boundingBox();
    expect(box).not.toBeNull();

    // Check what element is at the center of the down button
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    const hitElement = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return { tag: null, classes: '' };
      return {
        tag: el.tagName.toLowerCase(),
        classes: el.className,
        isLipBtn: el.closest('.mobile-lip-btn-down') !== null,
      };
    }, { x: centerX, y: centerY });

    // The element at the button's center should be the button itself (or a child)
    expect(hitElement.isLipBtn).toBe(true);
  });

  test('tapping down lip button navigates to next row', async ({ page }) => {
    // Read activeCell before tap
    const cellBefore = await page.evaluate(() => {
      // activeCell is in React state — check the slider transform
      const slider = document.querySelector('.mobile-grid-slider');
      return slider?.style?.transform || '';
    });

    const downBtn = page.locator('.mobile-lip-btn-down');
    await downBtn.tap();
    await page.waitForTimeout(200);

    const cellAfter = await page.evaluate(() => {
      const slider = document.querySelector('.mobile-grid-slider');
      return slider?.style?.transform || '';
    });

    // Transform should have changed (moved down one row)
    expect(cellAfter).not.toBe(cellBefore);
  });

  test('all four lip buttons render for interior cell on 2x3 grid', async ({ page }) => {
    const { rows, cols } = await getGridDimensions(page);
    if (rows < 2 || cols < 2) return;

    // Navigate right first (to get to an interior-ish cell)
    const rightBtn = page.locator('.mobile-lip-btn-right');
    const rightExists = await rightBtn.count();
    if (rightExists > 0) {
      await rightBtn.tap();
      await page.waitForTimeout(200);
    }

    // Now at (0,1) on a 2x3 grid — should have left, right, and down buttons
    // (no up because row=0)
    const left = await page.locator('.mobile-lip-btn-left').count();
    const right = await page.locator('.mobile-lip-btn-right').count();
    const down = await page.locator('.mobile-lip-btn-down').count();
    expect(left).toBe(1);
    expect(right).toBe(1);
    expect(down).toBe(1);
  });
});

// ============================================================
// FIX 5: RadialMenu arc items stay within viewport
// ============================================================
test.describe('Fix 5 — RadialMenu viewport clamping', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);
  });

  test('opening radial menu near edge keeps all items within viewport', async ({ page }) => {
    // Find a panel header (has a radial menu handle)
    const panelHeader = page.locator('.panel-header').first();
    const visible = await panelHeader.isVisible().catch(() => false);
    if (!visible) return;

    // Hover + click the handle to open the radial arc
    await panelHeader.hover();
    const handle = panelHeader.locator('[data-testid="radial-handle"]').first();
    const handleVisible = await handle.isVisible().catch(() => false);
    if (!handleVisible) return;

    await handle.click();
    await page.waitForTimeout(400);

    // Check all radial menu arc items are within viewport
    const arcItems = page.locator('.radial-menu-item');
    const count = await arcItems.count();
    if (count === 0) return; // menu didn't open

    const viewport = page.viewportSize();
    for (let i = 0; i < count; i++) {
      const box = await arcItems.nth(i).boundingBox();
      if (!box) continue;
      expect(box.x).toBeGreaterThanOrEqual(-2); // small tolerance
      expect(box.y).toBeGreaterThanOrEqual(-2);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 2);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 2);
    }
  });
});

// ============================================================
// FIX 6: GridRadialMenu (bottom-right cog) hidden on mobile
// ============================================================
test.describe('Fix 6 — GridRadialMenu hidden on mobile', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);
  });

  test('GridRadialMenu is NOT in DOM on mobile', async ({ page }) => {
    // GridRadialMenu has class "grid-radial-menu" — should not render when isMobile=true
    const cog = page.locator('.grid-radial-menu');
    const count = await cog.count();
    expect(count).toBe(0);
  });

  test('no fixed element at bottom-right blocks content on mobile', async ({ page }) => {
    // Check that the bottom-right area of the viewport is not covered by a fixed element
    const viewport = page.viewportSize();
    const checkX = viewport.width - 30;
    const checkY = viewport.height - 30;

    const hitEl = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return { classes: '', position: '' };
      return {
        classes: el.className || '',
        position: getComputedStyle(el).position,
        isGridRadial: el.closest('.grid-radial-menu') !== null,
      };
    }, { x: checkX, y: checkY });

    expect(hitEl.isGridRadial).toBe(false);
  });
});

// ============================================================
// REGRESSION: Drag handles still visible on mobile
// (was broken by .module-dot { display: none } CSS rule)
// ============================================================
test.describe('Regression — Drag handles not hidden on mobile', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);
  });

  test('panel .module-dot is NOT display:none on mobile', async ({ page }) => {
    const dots = page.locator('.panel-header .module-dot');
    const count = await dots.count();
    expect(count).toBeGreaterThan(0);

    const display = await dots.first().evaluate(el => getComputedStyle(el).display);
    expect(display).not.toBe('none');
  });

  test('container .module-dot is NOT display:none on mobile', async ({ page }) => {
    const dots = page.locator('.container-header .module-dot');
    const count = await dots.count();
    expect(count).toBeGreaterThan(0);

    const display = await dots.first().evaluate(el => getComputedStyle(el).display);
    expect(display).not.toBe('none');
  });
});

// ============================================================
// REGRESSION: Screen not blocked (z-index fix)
// ============================================================
test.describe('Regression — Panels receive pointer events', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGrid(page);
  });

  test('no grid-cell has z-index >= 65', async ({ page }) => {
    const blocked = await page.evaluate(() => {
      const cells = document.querySelectorAll('.grid-cell');
      for (const cell of cells) {
        const z = parseInt(cell.style.zIndex || '0', 10);
        if (z >= 65) return { blocked: true, zIndex: z };
      }
      return { blocked: false };
    });

    expect(blocked.blocked).toBe(false);
  });

  test('clicking panel content area reaches the panel (not blocked)', async ({ page }) => {
    const panel = page.locator('[data-testid="panel-shell"]').first();
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();

    // Click center of panel
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    const hitEl = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return { isPanel: false };
      return { isPanel: el.closest('[data-testid="panel-shell"]') !== null };
    }, { x: cx, y: cy });

    expect(hitEl.isPanel).toBe(true);
  });
});
