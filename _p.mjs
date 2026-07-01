import { chromium } from "playwright";
const token="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2OTliYmRmYmY2MmIwNjAxODIyNWI5MWEiLCJpYXQiOjE3ODEwNjI2MjIsImV4cCI6MTc4MTY2NzQyMn0.Q67K3G48QieSO5j5VCoPq4zNf7u5xskw6kHMl_OZrRw";
const b=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await b.newPage({viewport:{width:1700,height:1100}});
await page.goto("http://localhost:5000/",{waitUntil:"domcontentloaded"});
await page.evaluate(t=>{localStorage.setItem("moduli-token",t);localStorage.setItem("moduli-gridId","6a28b32005ba4f7c546ed664");localStorage.setItem("moduli-userId","699bbdfbf62b06018225b91a");},token);
await page.reload({waitUntil:"networkidle"});
await page.waitForTimeout(14000);
const s=await page.evaluate(()=>{
  const wgs=[...document.querySelectorAll(".wrap-group")];
  return {wg:wgs.length, spacers:document.querySelectorAll(".wrap-spacer").length,
    clipped:[...document.querySelectorAll(".wrap-group .textblock-card")].filter(c=>getComputedStyle(c).clipPath!=="none").length,
    sample: wgs.slice(0,3).map(w=>{const h=w.querySelector(".wrap-group-content>*")?.children?.[0]; const tc=h?.querySelector(".textblock-card"); const n=w.querySelector(".wrap-group-content>*")?.children?.[1]; const nr=n?.getBoundingClientRect();
      return {notchY:getComputedStyle(w).getPropertyValue("--notch-y").trim(), clip:tc?getComputedStyle(tc).clipPath.slice(0,40):"none", cls:tc?.className, neigh:n?{w:Math.round(nr.width),h:Math.round(nr.height)}:null};})};
});
console.log("STATE:",JSON.stringify(s,null,2));
await page.evaluate(()=>{const w=[...document.querySelectorAll(".wrap-group")].filter(x=>x.querySelector("img"))[1]; w&&w.scrollIntoView({block:"center"});});
await page.waitForTimeout(1200);
const rect=await page.evaluate(()=>{const w=[...document.querySelectorAll(".wrap-group")].filter(x=>x.querySelector("img"))[1]; if(!w)return null; const r=w.getBoundingClientRect(); return {x:Math.max(0,r.x-14),y:Math.max(0,r.y-14),width:Math.min(720,r.width+28),height:Math.min(520,r.height+28)};});
if(rect) await page.screenshot({path:"/home/joshpoms/moduli/screenshots/notch-now.png",clip:rect});
await b.close();
