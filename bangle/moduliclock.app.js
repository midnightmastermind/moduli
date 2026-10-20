// Moduli Clock — a Casio-style face for Bangle.js 2 with a "+" that adds a
// textblock to Moduli. Tap "+" → pick a preset or type → POST /api/v1/share
// (mode "manual", role "textblock") through Gadgetbridge. No phone connection?
// The text is kept on the watch and sent the next time you open the menu.
{
const storage = require("Storage");
const SETTINGS = "moduliclock.json";
const QUEUE = "moduliclock.queue.json";
require("Font7x11Numeric7Seg").add(Graphics);

const cfg = Object.assign({
  url: "https://viafluere.com",
  token: "",      // Moduli API token (Command Center › Connections)
  gridId: "",     // which grid
  parentId: "",   // the container the textblocks go into
  presets: ["Drink water", "Took meds", "Idea: "],
}, storage.readJSON(SETTINGS, 1) || {});

const W = g.getWidth(), H = g.getHeight();          // 176 × 176
const LCD = { x: 6, y: 44, w: W - 12, h: 88 };      // the light "screen"
const PLUS = { x: W - 50, y: H - 42, w: 44, h: 38 }; // tap area for "+"
const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
let drawTimeout;

const pending = () => storage.readJSON(QUEUE, 1) || [];
const setPending = (q) => storage.writeJSON(QUEUE, q);
const pad = (n) => ("0" + n).slice(-2);

function draw() {
  const d = new Date();
  g.reset().setBgColor("#000").clearRect(0, 24, W - 1, H - 1);

  // Bezel lettering
  g.setColor("#fff").setFont("6x8").setFontAlign(0, 0);
  g.drawString("M O D U L I", W / 2, 32);
  g.setColor("#0ff").drawString("QUICK ADD  WATER RESIST", W / 2, 40 + LCD.h + 10);

  // LCD panel
  g.setColor("#fff").fillRect(LCD.x, LCD.y, LCD.x + LCD.w, LCD.y + LCD.h);
  g.setColor("#000").drawRect(LCD.x + 2, LCD.y + 2, LCD.x + LCD.w - 2, LCD.y + LCD.h - 2);

  // Top row: day + date (small 7-segment)
  g.setFont("6x8:2").setFontAlign(-1, -1).drawString(DAYS[d.getDay()], LCD.x + 8, LCD.y + 8);
  g.setFont("7x11Numeric7Seg:2").setFontAlign(1, -1)
    .drawString(pad(d.getMonth() + 1) + "-" + pad(d.getDate()), LCD.x + LCD.w - 8, LCD.y + 6);

  // Big time, colon drawn as two squares so it never depends on the font
  let h = d.getHours();
  const pm = h >= 12;
  const is12 = (storage.readJSON("setting.json", 1) || {})["12hour"];
  if (is12) h = (h % 12) || 12;
  const cy = LCD.y + 34;
  g.setFont("7x11Numeric7Seg:4").setFontAlign(1, -1).drawString(pad(h), W / 2 - 6, cy);
  g.setFontAlign(-1, -1).drawString(pad(d.getMinutes()), W / 2 + 6, cy);
  g.fillRect(W / 2 - 2, cy + 12, W / 2 + 1, cy + 15).fillRect(W / 2 - 2, cy + 28, W / 2 + 1, cy + 31);
  if (is12) g.setFont("6x8").setFontAlign(-1, -1).drawString(pm ? "PM" : "AM", LCD.x + 8, cy + 2);

  // Battery, bottom-right of the screen (a "+" when charging)
  g.setFont("6x8").setFontAlign(1, 1)
    .drawString("BAT " + E.getBattery() + "%" + (Bangle.isCharging() ? "+" : ""), LCD.x + LCD.w - 8, LCD.y + LCD.h - 4);

  // Waiting-to-send count
  const n = pending().length;
  if (n) g.setFont("6x8").setFontAlign(-1, 1).drawString(n + " WAITING", LCD.x + 8, LCD.y + LCD.h - 4);

  // "+" button
  g.setColor("#fff").fillRect(PLUS.x, PLUS.y, PLUS.x + PLUS.w, PLUS.y + PLUS.h);
  g.setColor("#000").fillRect(PLUS.x + 19, PLUS.y + 7, PLUS.x + 25, PLUS.y + 31)
    .fillRect(PLUS.x + 10, PLUS.y + 16, PLUS.x + 34, PLUS.y + 22);
  g.setColor("#fff").setFont("6x8").setFontAlign(-1, 0).drawString("ADD >", 8, PLUS.y + PLUS.h / 2);

  queueDraw();
}

function queueDraw() {
  if (drawTimeout) clearTimeout(drawTimeout);
  drawTimeout = setTimeout(() => { drawTimeout = undefined; draw(); }, 60000 - (Date.now() % 60000));
}

function post(text) {
  if (!Bangle.http) return Promise.reject("no internet (Gadgetbridge)");
  if (!cfg.token || !cfg.gridId || !cfg.parentId) return Promise.reject("not set up");
  return Bangle.http(cfg.url + "/api/v1/share", {
    method: "POST",
    timeout: 20000,
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.token },
    body: JSON.stringify({
      gridId: cfg.gridId, source: "bangle", text: text, mode: "manual",
      placement: { parentId: cfg.parentId, role: "textblock", body: text },
    }),
  }).then((r) => {
    let j = {};
    try { j = JSON.parse(r.resp || "{}"); } catch (e) { /* non-JSON body */ }
    if (j.error) throw j.error.message || j.error;
    return j;
  });
}

function send(text) {
  text = (text || "").trim();
  if (!text) return load();
  E.showMessage("Sending...", "Moduli");
  post(text).then(() => {
    Bangle.buzz(60);
    E.showMessage("Added", "Moduli");
    setTimeout(load, 1000);
  }).catch((e) => {
    const q = pending(); q.push({ text: text, at: Date.now() }); setPending(q);
    E.showMessage("Kept on watch\n" + q.length + " waiting\n\n" + e, "Not sent");
    setTimeout(load, 2500);
  });
}

function sendPending() {
  const q = pending();
  if (!q.length) return load();
  E.showMessage("Sending " + q.length + "...", "Moduli");
  const next = () => {
    const left = pending();
    if (!left.length) { Bangle.buzz(60); return load(); }
    post(left[0].text).then(() => { setPending(left.slice(1)); next(); })
      .catch((e) => { E.showMessage(left.length + " still waiting\n\n" + e, "Not sent"); setTimeout(load, 2500); });
  };
  next();
}

function type(start) {
  let ti;
  try { ti = require("textinput"); } catch (e) { ti = null; }
  if (!ti) return E.showAlert("Install a keyboard app\n(Swipe or Touch keyboard)").then(load);
  ti.input({ text: start || "" }).then(send);
}

function openAdd() {
  if (drawTimeout) clearTimeout(drawTimeout);
  drawTimeout = undefined;
  Bangle.removeListener("touch", onTouch);
  Bangle.removeListener("charging", draw);
  const menu = { "": { title: "Add textblock", back: load }, "Type...": () => type("") };
  cfg.presets.forEach((p) => {
    // A preset ending in ": " opens the keyboard with it filled in.
    menu[p] = /:\s$/.test(p) ? () => type(p) : () => send(p);
  });
  const n = pending().length;
  if (n) menu["Send waiting (" + n + ")"] = sendPending;
  E.showMenu(menu);
}

function onTouch(btn, xy) {
  if (xy && xy.x >= PLUS.x - 8 && xy.y >= PLUS.y - 8) openAdd();
}

Bangle.setUI({
  mode: "clock",
  remove: () => {
    if (drawTimeout) clearTimeout(drawTimeout);
    drawTimeout = undefined;
    Bangle.removeListener("touch", onTouch);
    Bangle.removeListener("charging", draw);
  },
});
Bangle.on("touch", onTouch);
Bangle.on("charging", draw);
Bangle.loadWidgets();
draw();
Bangle.drawWidgets();
}
