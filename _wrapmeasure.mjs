import { chromium } from 'playwright-core';
const token = process.env.TOKEN;
const browser = await chromium.launch({ executablePath:'/home/joshpoms/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome', args:['--no-sandbox'] });
const page = await browser.newPage({ viewport:{width:1000,height:900} });
await page.goto('http://localhost:5000',{waitUntil:'domcontentloaded'});
await page.evaluate(([t,g,u])=>{localStorage.setItem('moduli-token',t);localStorage.setItem('moduli-gridId',g);localStorage.setItem('moduli-userId',u);},[token,'6a2ff50a34a7ab5bd986ba23','699bbdfbf62b06018225b91a']);
await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(6000);
const r = await page.evaluate(() => {
  const wgs=[...document.querySelectorAll('.wrap-group--on')];
  const lead=wgs.find(w=>{const n=w.querySelector('.wrap-group-content > *')?.children[0]; return n&&n.getBoundingClientRect().height>400;});
  if(!lead) return {no:1};
  const holder=lead.querySelector('.wrap-group-content > *'); const nb=holder.children[0]; const nbR=nb.getBoundingClientRect();
  const pm=holder.children[holder.children.length-1].querySelector('.ProseMirror'); const pmR=pm.getBoundingClientRect();
  // collect every text line rect across all text nodes in reading order
  const walker=document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
  const lines=[]; let node; const range=document.createRange();
  while((node=walker.nextNode())){ const len=node.textContent.length; if(!len)continue; let prevTop=null;
    for(let i=0;i<len;i++){ range.setStart(node,i); range.setEnd(node,i+1); const rc=range.getBoundingClientRect(); if(rc.width===0&&rc.height===0)continue;
      if(prevTop===null||Math.abs(rc.top-prevTop)>4){ lines.push({top:Math.round(rc.top),left:Math.round(rc.left),right:Math.round(rc.right)}); prevTop=rc.top; } else { lines[lines.length-1].right=Math.round(Math.max(lines[lines.length-1].right,rc.right)); } } }
  const W=l=>l.right-l.left;
  const top3=lines.slice(0,3).map(l=>({y:l.top,w:W(l)}));
  const last3=lines.slice(-3).map(l=>({y:l.top,w:W(l)}));
  // find transition: first line whose width jumps to > narrow+40
  const narrow=W(lines[0]); let trans=null;
  for(const l of lines){ if(W(l)>narrow+60){ trans={y:l.top,w:W(l)}; break; } }
  return { pmLeft:Math.round(pmR.left), pmW:Math.round(pmR.width), neighborTop:Math.round(nbR.top), neighborBottom:Math.round(nbR.bottom), narrowLineW:narrow, transition:trans, lineCount:lines.length, top3, last3 };
});
console.log(JSON.stringify(r,null,1));
await browser.close();
