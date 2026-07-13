// Verify the [caret] diagnostics fire + capture the desktop baseline.
import { chromium } from "playwright";
const CREDS = {
  userId: "699bbdfbf62b06018225b91a",
  gridId: "6a4dd63ca2442db16be3e6c9",
  token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2OTliYmRmYmY2MmIwNjAxODIyNWI5MWEiLCJpYXQiOjE3ODMzOTQ4NDMsImV4cCI6MTc4Mzk5OTY0M30.x4yIcvfHRVYZI2t1IieNQvV364qKpgG-g2RcX8d0DCI",
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
page.on("console", m => { const t = m.text(); if (t.startsWith("[caret]")) console.log(t.slice(0, 260)); });
await page.goto("http://localhost:5000", { waitUntil: "domcontentloaded" });
await page.evaluate((c) => {
  localStorage.setItem("moduli-token", c.token);
  localStorage.setItem("moduli-gridId", c.gridId);
  localStorage.setItem("moduli-userId", c.userId);
}, CREDS);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-panel-id]", { timeout: 60000, state: "attached" });
await sleep(12000);

// 1. inline chip middle
const chip = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll(".itbi-content")).filter(e => (e.textContent || "").length > 8);
  if (!els[0]) return null;
  els[0].scrollIntoView({ block: "center" });
  return true;
});
await sleep(600);
const chipPt = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll(".itbi-content")).filter(e => (e.textContent || "").length > 8);
  const r = els[0]?.getBoundingClientRect();
  return r?.width ? { x: r.left + r.width * 0.6, y: r.top + r.height / 2, text: els[0].textContent.slice(0, 20) } : null;
});
console.log("== CHIP:", JSON.stringify(chipPt));
if (chipPt) { await page.mouse.click(chipPt.x, chipPt.y); await sleep(700); }

// 2. block textblock middle (textblock card prose inside a doc)
const tbPt = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll(".textblock-card .ProseMirror p"))
    .filter(e => (e.textContent || "").length > 60);
  if (!els[0]) return null;
  els[0].scrollIntoView({ block: "center" });
  return true;
});
await sleep(600);
const tbPt2 = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll(".textblock-card .ProseMirror p"))
    .filter(e => (e.textContent || "").length > 60);
  const r = els[0]?.getBoundingClientRect();
  return r?.width ? { x: r.left + r.width * 0.5, y: r.top + 8, text: els[0].textContent.slice(0, 24) } : null;
});
console.log("== TEXTBLOCK:", JSON.stringify(tbPt2));
if (tbPt2) { await page.mouse.click(tbPt2.x, tbPt2.y); await sleep(700); }
await browser.close();
