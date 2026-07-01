import { chromium } from 'playwright-core';
const token = process.env.TOKEN;
const browser = await chromium.launch({ executablePath:'/home/joshpoms/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome', args:['--no-sandbox'] });
const page = await browser.newPage({ viewport:{width:1100,height:900} });
await page.goto('http://localhost:5000',{waitUntil:'domcontentloaded'});
await page.evaluate(([t,g,u])=>{localStorage.setItem('moduli-token',t);localStorage.setItem('moduli-gridId',g);localStorage.setItem('moduli-userId',u);},[token,'6a2ff50a34a7ab5bd986ba23','699bbdfbf62b06018225b91a']);
await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(5000);
const r = await page.evaluate(() => {
  const out=[];
  document.querySelectorAll('.wrap-group--on').forEach((wg,i)=>{
    const holder=wg.querySelector('.wrap-group-content > *'); if(!holder)return;
    const kids=[...holder.children]; const nb=kids[0];
    const nbRect=nb.getBoundingClientRect();
    const notchH=getComputedStyle(wg).getPropertyValue('--notch-h').trim();
    const notchW=getComputedStyle(wg).getPropertyValue('--notch-w').trim();
    const pm=kids[kids.length-1].querySelector('.ProseMirror');
    const beforeH=pm?getComputedStyle(pm,'::before').height:null;
    out.push({ i, neighborH:Math.round(nbRect.height), notchH, notchW, beforeH });
  });
  return out;
});
console.log(JSON.stringify(r,null,1));
await browser.close();
