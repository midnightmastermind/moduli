import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { classifyOutcome, controlsIn, crawlSurface } from "../crawl.mjs";
import { guardScript } from "../writeGuard.mjs";

const base = { url: "u", focused: "a", popups: 0, writes: 0, errors: 0, mutations: 0, noise: 0, states: "" };

test("classifyOutcome", () => {
  assert.equal(classifyOutcome(base, { ...base }), "nothing");
  assert.equal(classifyOutcome(base, { ...base, popups: 1 }), "opened");
  assert.equal(classifyOutcome(base, { ...base, writes: 1 }), "wrote");
  assert.equal(classifyOutcome(base, { ...base, errors: 1, popups: 1 }), "error"); // an error outranks everything
  assert.equal(classifyOutcome(base, { ...base, url: "v" }), "navigated");
  assert.equal(classifyOutcome(base, { ...base, mutations: 9, noise: 2 }), "changed");
  assert.equal(classifyOutcome(base, { ...base, mutations: 2, noise: 2 }), "nothing"); // background noise is not a change
  assert.equal(classifyOutcome(base, { ...base, states: "x" }), "changed"); // aria-pressed / checked / expanded flipped
});

const FIXTURE = `<!doctype html><html><head><style>
  .row .hv { opacity: 0 } .row:hover .hv { opacity: 1 }
  button { width: 60px; height: 40px }
</style></head><body><div id="root">
  <button id="ok" onclick="const m=document.createElement('div');m.setAttribute('role','menu');m.textContent='menu';document.body.appendChild(m)">Open</button>
  <button id="dead">Dead</button>
  <div class="row"><span>Row</span><button class="hv" aria-label="Add field" onclick="this.closest('.row').append(' added')">+</button></div>
  <button id="w" onclick="window.__ws.send('42[&quot;update_occurrence&quot;,{}]')">Save</button>
  <button aria-label="Delete row" onclick="document.body.remove()">x</button>
</div><script>window.__ws = new WebSocket("ws://127.0.0.1:9");</script></body></html>`;

let browser, page;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser.close(); });

test("controlsIn finds every control, and marks the hover-only one", async () => {
  page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
  await page.setContent(FIXTURE);
  const cs = await controlsIn(page, "#root");
  assert.deepEqual(cs.map((c) => c.label), ["Open", "Dead", "Add field", "Save", "Delete row"]);
  assert.deepEqual(cs.map((c) => c.hoverOnly), [false, false, true, false, false]);
});

test("crawlSurface: opened, nothing, hover-only change, wrote; a destructive one is skipped", async () => {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  await ctx.addInitScript(guardScript(false));
  page = await ctx.newPage();
  const surface = { id: "fx", name: "Fixture", root: "#root", open: async (p) => { await p.setContent(FIXTURE); } };
  const rows = await crawlSurface(page, surface, { vp: "desktop", depth: 1, settleMs: 150 });
  const by = Object.fromEntries(rows.map((r) => [r.control, r]));
  assert.equal(by.Open.works, "✅ opened");
  assert.equal(by.Dead.works, "✗ nothing");
  assert.equal(by["Add field"].works, "✅ changed");
  assert.match(by["Add field"].reach, /hover-only/);
  assert.equal(by.Save.works, "✅ wrote");
  assert.match(by["Delete row"].works, /skipped/);
});
