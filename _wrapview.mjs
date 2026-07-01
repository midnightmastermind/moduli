import { chromium } from 'playwright-core';
const token = process.env.TOKEN;
const browser = await chromium.launch({ executablePath:'/home/joshpoms/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome', args:['--no-sandbox'] });
const page = await browser.newPage({ viewport:{width:1000,height:1700} });
await page.goto('http://localhost:5000',{waitUntil:'domcontentloaded'});
await page.evaluate(([t,g,u])=>{localStorage.setItem('moduli-token',t);localStorage.setItem('moduli-gridId',g);localStorage.setItem('moduli-userId',u);},[token,'6a2ff50a34a7ab5bd986ba23','699bbdfbf62b06018225b91a']);
await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(5500);
// find the lead wrap (container neighbor, tall) and scroll its panel so its top is visible
await page.evaluate(() => { const wgs=[...document.querySelectorAll('.wrap-group--on')]; const lead=wgs.find(w=>{const n=w.querySelector('.wrap-group-content > *')?.children[0]; return n&&n.getBoundingClientRect().height>400;}); if(lead){ const sc=lead.closest('[style*="overflow"],.doc-editor-content,.ProseMirror')||lead; lead.scrollIntoView({block:'start'}); } });
await page.waitForTimeout(800);
await page.screenshot({ path:'/home/joshpoms/moduli/_wrap_view.png' });
console.log('shot');
await browser.close();
