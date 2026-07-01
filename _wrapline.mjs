import { chromium } from 'playwright-core';
const token = process.env.TOKEN;
const browser = await chromium.launch({ executablePath:'/home/joshpoms/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome', args:['--no-sandbox'] });
const page = await browser.newPage({ viewport:{width:1100,height:900} });
await page.goto('http://localhost:5000',{waitUntil:'domcontentloaded'});
await page.evaluate(([t,g,u])=>{localStorage.setItem('moduli-token',t);localStorage.setItem('moduli-gridId',g);localStorage.setItem('moduli-userId',u);},[token,'6a2ff50a34a7ab5bd986ba23','699bbdfbf62b06018225b91a']);
await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(4500);
const r = await page.evaluate(() => {
  const wg=document.querySelector('.wrap-group--on'); const pm=wg&&wg.querySelector('.ProseMirror'); if(!pm) return {no:1};
  // measure individual line rects of the first paragraph via Range over text nodes
  const p=pm.querySelector('p'); const tn=[...p.childNodes].find(n=>n.nodeType===3); 
  const range=document.createRange();
  const lines=[];
  if(tn){ const len=tn.textContent.length; let prevTop=null;
    for(let i=0;i<len;i++){ range.setStart(tn,i); range.setEnd(tn,Math.min(i+1,len)); const rc=range.getBoundingClientRect();
      if(prevTop===null||Math.abs(rc.top-prevTop)>3){ lines.push({top:Math.round(rc.top),left:Math.round(rc.left)}); prevTop=rc.top; if(lines.length>6)break; } } }
  // width of each detected line: re-measure full line by char scan max-right per top
  const pmRect=pm.getBoundingClientRect();
  return { pmLeft:Math.round(pmRect.left), pmRight:Math.round(pmRect.right), pmW:Math.round(pmRect.width), firstLines:lines, before:(cs=>({float:cs.float,w:cs.width,h:cs.height}))(getComputedStyle(pm,'::before')) };
});
console.log(JSON.stringify(r,null,1));
await browser.close();
