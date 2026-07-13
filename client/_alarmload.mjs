import { chromium } from "playwright";
const CREDS = {
  userId: "699bbdfbf62b06018225b91a",
  gridId: "6a4dd63ca2442db16be3e6c9",
  token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2OTliYmRmYmY2MmIwNjAxODIyNWI5MWEiLCJpYXQiOjE3ODMzOTQ4NDMsImV4cCI6MTc4Mzk5OTY0M30.x4yIcvfHRVYZI2t1IieNQvV364qKpgG-g2RcX8d0DCI",
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on("console", m => logs.push(m.text()));
await page.goto("http://localhost:5000", { waitUntil: "domcontentloaded" });
await page.evaluate((c) => {
  localStorage.setItem("moduli-token", c.token);
  localStorage.setItem("moduli-gridId", c.gridId);
  localStorage.setItem("moduli-userId", c.userId);
}, CREDS);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-panel-id]", { timeout: 60000, state: "attached" });
await sleep(16000);
const alarmToast = await page.evaluate(() => document.body.innerText.includes("⏰"));
const opTiming = logs.find(t => t.includes("[op-timing]")) || "";
const alarmInSweep = /Alarm: 5 PM|Alarm: 6:30/.test(opTiming) || logs.some(t => /Alarm: 5 PM|Alarm: 6:30/.test(t) && t.includes("ms"));
console.log("RESULT alarm toast at load:", alarmToast, "| alarm ops in onLoad sweep:", alarmInSweep, "| ops line sample:", opTiming.slice(0, 80));
await browser.close();
