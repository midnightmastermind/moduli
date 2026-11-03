// tools/uisweep/timing.mjs — performance as the user feels it.

/** ms from the page's own input event (pointerdown / touchstart / keydown) to the first frame where `doneFn` (run in
 *  the page) is true. Measured inside the page, so Playwright's round trip is not counted. -1 = never within timeout. */
export async function timeToPaint(page, act, doneFn, { timeout = 10000 } = {}) {
  await page.evaluate(() => {
    if (!window.__inputClock) {
      window.__inputClock = true;
      for (const t of ["pointerdown", "touchstart", "keydown"]) window.addEventListener(t, () => { window.__lastInput = performance.now(); }, true);
    }
    window.__lastInput = 0;
  });
  await act();
  return page.evaluate(async ({ src, timeout }) => {
    const done = new Function(`return (${src})()`);
    const t0 = performance.now();
    return await new Promise((res) => {
      const tick = () => {
        const from = window.__lastInput || t0;
        if (done()) return res(Math.round(performance.now() - from));
        if (performance.now() - t0 > timeout) return res(-1);
        requestAnimationFrame(tick);
      };
      tick();
    });
  }, { src: doneFn.toString(), timeout });
}

/** Scroll a scroller n steps of dy; ms per step (median, worst) measured to the next painted frame. */
export async function scrollSteps(page, scrollerSel, { n = 40, dy = 400 } = {}) {
  return page.evaluate(async ({ sel, n, dy }) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const ts = [];
    for (let i = 0; i < n; i++) {
      const t = performance.now();
      el.scrollTop += dy;
      await frame();
      ts.push(performance.now() - t);
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) break;
    }
    const s = [...ts].sort((a, b) => a - b);
    return { steps: ts.length, medianMs: Math.round(s[Math.floor(s.length / 2)]), worstMs: Math.round(s[s.length - 1]), totalMs: Math.round(ts.reduce((a, b) => a + b, 0)) };
  }, { sel: scrollerSel, n, dy });
}

/** The longest gap between frames over a window — a freeze the user sees. */
export async function longestFreeze(page, windowMs = 10000) {
  return page.evaluate((w) => new Promise((res) => {
    let last = performance.now(), worst = 0; const end = last + w;
    const tick = () => { const t = performance.now(); worst = Math.max(worst, t - last); last = t; if (t < end) requestAnimationFrame(tick); else res(Math.round(worst)); };
    requestAnimationFrame(tick);
  }), windowMs);
}
