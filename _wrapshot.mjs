import { chromium } from 'playwright-core';
const token = process.env.TOKEN;
const exe = '/home/joshpoms/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: exe, args:['--no-sandbox'] });
const page = await browser.newPage({ viewport:{width:1100,height:900} });
await page.goto('http://localhost:5000', { waitUntil:'domcontentloaded' });
await page.evaluate(([t,g,u]) => { localStorage.setItem('moduli-token',t); localStorage.setItem('moduli-gridId',g); localStorage.setItem('moduli-userId',u); }, [token,'6a2ff50a34a7ab5bd986ba23','699bbdfbf62b06018225b91a']);
await page.reload({ waitUntil:'networkidle' });
await page.waitForTimeout(4500);
const wg = await page.$('.wrap-group--on');
if (wg) { await wg.screenshot({ path: '/home/joshpoms/moduli/_wrap_lead.png' }); console.log('shot saved'); }
else console.log('no wrap-group--on');
await browser.close();
