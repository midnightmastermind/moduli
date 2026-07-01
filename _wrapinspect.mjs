import { chromium } from 'playwright-core';
const token = process.env.TOKEN;
const exe = '/home/joshpoms/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: exe, args:['--no-sandbox'] });
const page = await browser.newPage({ viewport:{width:1400,height:1000} });
await page.goto('http://localhost:5000', { waitUntil:'domcontentloaded' });
await page.evaluate(([t,g,u]) => { localStorage.setItem('moduli-token',t); localStorage.setItem('moduli-gridId',g); localStorage.setItem('moduli-userId',u); }, [token,'6a2ff50a34a7ab5bd986ba23','699bbdfbf62b06018225b91a']);
await page.reload({ waitUntil:'networkidle' });
await page.waitForTimeout(4500);
const info = await page.evaluate(() => {
  const wg = document.querySelector('.wrap-group--on');
  if (!wg) return { found:false, wgCount: document.querySelectorAll('.wrap-group').length };
  const holder = wg.querySelector('.wrap-group-content > *') || wg.querySelector('.wrap-group-content');
  const kids = holder ? Array.from(holder.children) : [];
  const neighbor = kids[0], host = kids[kids.length-1];
  const fc = el => { if(!el) return null; const s=getComputedStyle(el); const r=el.getBoundingClientRect(); return { cls:(el.className||'').toString().slice(0,38), display:s.display, float:s.float, contain:s.contain, cv:s.contentVisibility, overflow:s.overflowX+'/'+s.overflowY, clipPath:(s.clipPath||'none').slice(0,18), w:Math.round(r.width), x:Math.round(r.left), y:Math.round(r.top) }; };
  XXX
  for (let i=0;i<14 && el;i++){ chain.push(fc(el)); el = el.firstElementChild; }
  return { found:true, side:wg.getAttribute('data-side'), notchW:getComputedStyle(wg).getPropertyValue('--notch-w'), notchH:getComputedStyle(wg).getPropertyValue('--notch-h'), neighbor:fc(neighbor), holderDisplay:getComputedStyle(holder).display, hostChain:chain };
});
console.log(JSON.stringify(info,null,1));
await browser.close();
