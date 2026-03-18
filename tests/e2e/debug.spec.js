const { test, expect } = require('@playwright/test');
const LOAD_TIMEOUT = 30000;

test('debug panel content', async ({ page }) => {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text().substring(0, 200));
  });

  await page.goto('/');
  await page.waitForSelector('[data-testid="panel-shell"]', { timeout: LOAD_TIMEOUT });
  await page.waitForTimeout(2000);

  const panels = await page.locator('[data-testid="panel-shell"]').count();
  console.log('Panel count:', panels);

  const allTexts = await page.locator('[data-testid="panel-shell"]').allInnerTexts();
  allTexts.forEach((t, i) => {
    console.log(`Panel ${i}: ${t.substring(0, 150).replace(/\n/g, ' | ')}`);
  });

  const bodyText = await page.locator('body').innerText();
  const crashText = bodyText.split('\n').filter(l => l.includes('crash') || l.includes('Error') || l.includes('error'));
  console.log('Crash/error lines:', crashText.slice(0, 5));

  console.log('Console errors:', errors.slice(0, 5));

  expect(panels).toBeGreaterThanOrEqual(4);
});
