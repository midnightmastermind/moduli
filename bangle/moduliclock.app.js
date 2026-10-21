// Moduli Clock — a Casio-style face for Bangle.js 2. Four buttons along the
// bottom:
//   ⏯  play / pause whatever is playing on the phone (Spotify included),
//       through Gadgetbridge's music control
//   POMO a pomodoro timer on the watch: tap to start, tap to pause / resume.
//       Work, then a break; it buzzes at the end of each. The time left shows
//       on the screen. Reset it from the + menu.
//   AI start the phone's voice assistant (talk to it through your headphones)
//   +  add a textblock — pick a preset or type → POST /api/v1/share
//       (mode "manual", role "textblock"). No phone connection? The text is
//       kept on the watch and sent the next time you open the menu.
{
const storage = require("Storage");
const SETTINGS = "moduliclock.json";
const QUEUE = "moduliclock.queue.json";
// Launchers read every .info file, and Folder Launcher crashes on one it cannot
// parse (it sorts them with readJSON(file, false)) — which sends the button
// straight back to the clock. A hand upload can leave this file altered, so
// the clock rewrites it whenever it does not read back as this exact record.
const INFO = { id: "moduliclock", name: "Moduli Clock", type: "clock", src: "moduliclock.app.js", version: "0.2",
  storage: [{ name: "moduliclock.app.js" }, { name: "moduliclock.info" }], data: [{ name: "moduliclock.json" },
  { name: "moduliclock.queue.json" }, { name: "moduliclock.pomo.json" }] };
{
  const cur = storage.readJSON("moduliclock.info", 1);
  if (!cur || cur.id !== INFO.id || cur.src !== INFO.src || cur.version !== INFO.version) storage.writeJSON("moduliclock.info", INFO);
}
const POMO = "moduliclock.pomo.json";      // the timer, kept so it survives menus
// The 7-segment digits come from a module the watch may not have (the App
// Loader installs it with some clocks; a file uploaded by hand gets no
// modules). Without it the face uses the built-in Vector font instead of
// failing to start.
let SEG_SMALL = "Vector:22", SEG_BIG = "Vector:40";
try {
  require("Font7x11Numeric7Seg").add(Graphics);
  SEG_SMALL = "7x11Numeric7Seg:2"; SEG_BIG = "7x11Numeric7Seg:4";
} catch (e) { /* no 7-segment font on this watch */ }

const cfg = Object.assign({
  url: "https://viafluere.com",
  token: "",      // Moduli API token (Command Center › Connections)
  gridId: "",     // which grid
  parentId: "",   // the container the textblocks go into
  presets: ["Drink water", "Took meds", "Idea: "],
  pomoWork: 25,   // minutes
  pomoBreak: 5,   // minutes
}, storage.readJSON(SETTINGS, 1) || {});

const W = g.getWidth(), H = g.getHeight();          // 176 × 176
const LCD = { x: 6, y: 44, w: W - 12, h: 88 };      // the light "screen"
// Bottom row: four equal buttons. A tap anywhere at or below BTN_Y picks one
// by which quarter of the screen it landed in.
const BTN_Y = H - 42, BTN_W = 38, BTN_H = 38, BTN_GAP = (W - 12 - 4 * BTN_W) / 3;
const BTN_X = [0, 1, 2, 3].map((i) => 6 + i * (BTN_W + BTN_GAP)); // music · pomo · AI · +
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

  // LCD panel
  g.setColor("#fff").fillRect(LCD.x, LCD.y, LCD.x + LCD.w, LCD.y + LCD.h);
  g.setColor("#000").drawRect(LCD.x + 2, LCD.y + 2, LCD.x + LCD.w - 2, LCD.y + LCD.h - 2);

  // Top row: day + date (small 7-segment)
  g.setFont("6x8:2").setFontAlign(-1, -1).drawString(DAYS[d.getDay()], LCD.x + 8, LCD.y + 8);
  g.setFont(SEG_SMALL).setFontAlign(1, -1)
    .drawString(pad(d.getMonth() + 1) + "-" + pad(d.getDate()), LCD.x + LCD.w - 8, LCD.y + 6);

  // Big time, colon drawn as two squares so it never depends on the font
  let h = d.getHours();
  const pm = h >= 12;
  const is12 = (storage.readJSON("setting.json", 1) || {})["12hour"];
  if (is12) h = (h % 12) || 12;
  const cy = LCD.y + 34;
  g.setFont(SEG_BIG).setFontAlign(1, -1).drawString(pad(h), W / 2 - 6, cy);
  g.setFontAlign(-1, -1).drawString(pad(d.getMinutes()), W / 2 + 6, cy);
  g.fillRect(W / 2 - 2, cy + 12, W / 2 + 1, cy + 15).fillRect(W / 2 - 2, cy + 28, W / 2 + 1, cy + 31);
  if (is12) g.setFont("6x8").setFontAlign(-1, -1).drawString(pm ? "PM" : "AM", LCD.x + 8, cy + 2);

  // Battery, bottom-right of the screen (a "+" when charging)
  g.setFont("6x8").setFontAlign(1, 1)
    .drawString("BAT " + E.getBattery() + "%" + (Bangle.isCharging() ? "+" : ""), LCD.x + LCD.w - 8, LCD.y + LCD.h - 4);

  // Pomodoro, top-middle of the screen: "WORK 24:13" / "BREAK 3:02", "||" when paused
  const pt = pomoText();
  if (pt) g.setFont("6x8").setFontAlign(0, -1).drawString(pt, W / 2, LCD.y + 22);

  // Waiting-to-send count
  const n = pending().length;
  if (n) g.setFont("6x8").setFontAlign(-1, 1).drawString(n + " WAITING", LCD.x + 8, LCD.y + LCD.h - 4);

  drawButtons();

  queueDraw();
}

// What the phone last said is playing ("play" / "pause"); null when unknown.
function musicState() {
  try { return require("android").musicState || null; } catch (e) { return null; }
}

function drawButtons() {
  const y = BTN_Y, cy = y + BTN_H / 2;
  BTN_X.forEach((x) => g.setColor("#fff").fillRect(x, y, x + BTN_W, y + BTN_H));
  g.setColor("#000");
  // Play/pause: show PAUSE bars while something plays, else a play triangle.
  let x = BTN_X[0] + BTN_W / 2;
  if (musicState() === "play") g.fillRect(x - 9, cy - 10, x - 3, cy + 10).fillRect(x + 3, cy - 10, x + 9, cy + 10);
  else g.fillPoly([x - 7, cy - 11, x - 7, cy + 11, x + 10, cy]);
  // Pomodoro: play triangle (or pause bars while it runs) over "POMO"
  x = BTN_X[1] + BTN_W / 2;
  const py = cy - 5;
  if (pomo.running) g.fillRect(x - 6, py - 7, x - 2, py + 7).fillRect(x + 2, py - 7, x + 6, py + 7);
  else g.fillPoly([x - 5, py - 7, x - 5, py + 7, x + 7, py]);
  g.setFont("6x8").setFontAlign(0, 0).drawString("POMO", x, cy + 11);
  // AI
  g.setFont("6x8:2").setFontAlign(0, 0).drawString("AI", BTN_X[2] + BTN_W / 2, cy + 1);
  // "+"
  x = BTN_X[3] + BTN_W / 2;
  g.fillRect(x - 3, cy - 12, x + 3, cy + 12).fillRect(x - 12, cy - 3, x + 12, cy + 3);
}

function queueDraw() {
  if (drawTimeout) clearTimeout(drawTimeout);
  // Every second while a pomodoro runs (the countdown shows seconds), else on the minute.
  const wait = pomo.running ? 1000 - (Date.now() % 1000) : 60000 - (Date.now() % 60000);
  drawTimeout = setTimeout(() => { drawTimeout = undefined; draw(); }, wait);
}

// ── POMODORO ──────────────────────────────────────────────────────────────
// State: { phase: "work"|"break", running, end (ms, while running),
// left (ms, while paused) }, or {} when idle. Saved on every change, because
// the face reloads after each menu and would otherwise forget it.
// The end buzz goes through the Scheduler library when installed, so it rings
// even after you leave the clock; without it a timer on this face buzzes.
let pomo = storage.readJSON(POMO, 1) || {};
let pomoTimeout;
const savePomo = () => storage.writeJSON(POMO, pomo);
const phaseMs = (ph) => (ph === "break" ? cfg.pomoBreak : cfg.pomoWork) * 60000;

function pomoLeft() {
  if (!pomo.phase) return 0;
  return pomo.running ? Math.max(0, pomo.end - Date.now()) : pomo.left;
}

function pomoText() {
  if (!pomo.phase) return "";
  const s = Math.ceil(pomoLeft() / 1000);
  return (pomo.phase === "break" ? "BREAK " : "WORK ") + Math.floor(s / 60) + ":" + pad(s % 60) + (pomo.running ? "" : " ||");
}

function schedSet(ms, msg) {
  try {
    const sched = require("sched");
    const d = new Date();
    const now = ((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000;
    sched.setAlarm("moduliclock.pomo", { appid: "moduliclock", on: true, timer: ms, t: (now + ms) % 86400000,
      msg: msg, vibrate: "==", hidden: true, del: true });
    sched.reloadScheduler();
    return true;
  } catch (e) { return false; }
}
function schedClear() {
  try { const sched = require("sched"); sched.setAlarm("moduliclock.pomo", undefined); sched.reloadScheduler(); } catch (e) { /* no scheduler */ }
}

// (Re)arm the end of the running phase. Called on start/resume and on load.
function armPomo() {
  if (pomoTimeout) clearTimeout(pomoTimeout);
  pomoTimeout = undefined;
  if (!pomo.running) return;
  const left = pomo.end - Date.now();
  if (left <= 0) {
    // The phase ended while the face was closed (another app, or the
    // Scheduler's alarm screen). Pick up where the clock says we are now.
    const over = -left;
    if (pomo.phase === "work" && over < phaseMs("break")) return startPhase("break", phaseMs("break") - over);
    pomo = {}; savePomo(); return;
  }
  pomoTimeout = setTimeout(pomoPhaseEnded, left);
}

function pomoPhaseEnded() {
  pomoTimeout = undefined;
  if (!pomo.usesSched) Bangle.buzz(400).then(() => setTimeout(() => Bangle.buzz(400), 300));
  if (pomo.phase === "work") startPhase("break");   // work done → the break starts by itself
  else { pomo = {}; savePomo(); draw(); }            // break done → idle
}

function startPhase(phase, ms) {
  ms = ms || phaseMs(phase);
  pomo = { phase: phase, running: true, end: Date.now() + ms };
  pomo.usesSched = schedSet(ms, phase === "work" ? "Pomodoro done - take a break" : "Break over");
  savePomo();
  armPomo();
  draw();
}

function togglePomo() {
  Bangle.buzz(30);
  if (!pomo.phase) return startPhase("work");
  if (pomo.running) {                                // pause
    pomo = { phase: pomo.phase, running: false, left: pomoLeft() };
    schedClear();
    if (pomoTimeout) clearTimeout(pomoTimeout);
    pomoTimeout = undefined;
    savePomo();
    draw();
  } else startPhase(pomo.phase, pomo.left);          // resume
}

function resetPomo() {
  pomo = {};
  schedClear();
  if (pomoTimeout) clearTimeout(pomoTimeout);
  pomoTimeout = undefined;
  savePomo();
}

// Each entry gets its own id when it is made. The server treats two posts of
// the same text as one share unless the sender names them, so without this a
// second "Drink water" updated the first instead of adding a new textblock.
// The id rides along in the waiting list, so a retry can never land twice.
const newId = () => Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e9).toString(36);

function post(entry) {
  const text = entry.text;
  if (!Bangle.http) return Promise.reject("no internet (Gadgetbridge)");
  if (!cfg.token || !cfg.gridId || !cfg.parentId) return Promise.reject("not set up");
  return Bangle.http(cfg.url + "/api/v1/share", {
    method: "POST",
    timeout: 20000,
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.token },
    body: JSON.stringify({
      gridId: cfg.gridId, source: "bangle", text: text, mode: "manual", externalId: entry.id,
      placement: { parentId: cfg.parentId, role: "textblock", body: text },
    }),
  }).then((r) => {
    let j = {};
    try { j = JSON.parse(r.resp || "{}"); } catch (e) { /* non-JSON body */ }
    if (j.error) throw j.message || j.error;
    return j;
  });
}

function send(text) {
  text = (text || "").trim();
  if (!text) return load();
  const entry = { text: text, id: newId(), at: Date.now() };
  E.showMessage("Sending...", "Moduli");
  post(entry).then(() => {
    Bangle.buzz(60);
    E.showMessage("Added", "Moduli");
    setTimeout(load, 1000);
  }).catch((e) => {
    const q = pending(); q.push(entry); setPending(q);
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
    // Entries queued by an older version carry no id; give them one now.
    if (!left[0].id) { left[0].id = newId(); setPending(left); }
    post(left[0]).then(() => { setPending(left.slice(1)); next(); })
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
  stopFace();
  const menu = { "": { title: "Add textblock", back: load }, "Type...": () => type("") };
  cfg.presets.forEach((p) => {
    // A preset ending in ": " opens the keyboard with it filled in.
    menu[p] = /:\s$/.test(p) ? () => type(p) : () => send(p);
  });
  const n = pending().length;
  if (n) menu["Send waiting (" + n + ")"] = sendPending;
  if (pomo.phase) menu["Reset pomodoro"] = () => { resetPomo(); load(); };
  E.showMenu(menu);
}

// ── PLAY / PAUSE ──────────────────────────────────────────────────────────
// Gadgetbridge's own music control (the "android" app's boot code defines
// Bangle.musicControl). It controls the phone's active media session, so it
// works for Spotify and anything else playing. Sends pause while the phone
// reports playing, else play; the icon is flipped at once and corrected when
// the phone reports back.
function togglePlay() {
  if (!Bangle.musicControl) return E.showAlert("Needs the Android\nIntegration app\n(Gadgetbridge)").then(load);
  const playing = musicState() === "play";
  Bangle.musicControl(playing ? "pause" : "play");
  try { require("android").musicState = playing ? "pause" : "play"; } catch (e) { /* no android lib */ }
  Bangle.buzz(30);
  draw();
}

// ── VOICE ASSISTANT ───────────────────────────────────────────────────────
// Starts the phone's voice assistant, which listens and answers through your
// Bluetooth headphones when they are connected. Sent as an Android intent
// through Gadgetbridge ("Allow Intents" must be on in its Bangle.js settings).
// By default it opens whatever the phone has set as its default assistant
// (Settings > Apps > Default apps > Digital assistant app). cfg.voice can name
// another intent instead, e.g. {"action":"...","package":"...","class":"..."}.
function startVoice() {
  const v = cfg.voice || {};
  const msg = { t: "intent", target: v.target || "activity",
    action: v.action || "android.intent.action.VOICE_COMMAND",
    flags: ["FLAG_ACTIVITY_NEW_TASK"] };
  if (v.package) msg.package = v.package;
  if (v.class) msg.class = v.class;
  try {
    Bluetooth.println("");
    Bluetooth.println(JSON.stringify(msg));
    Bangle.buzz(80);
  } catch (e) {
    E.showAlert("Phone not\nconnected").then(load);
  }
}

function stopFace() {
  if (drawTimeout) clearTimeout(drawTimeout);
  drawTimeout = undefined;
  if (pomoTimeout) clearTimeout(pomoTimeout);
  pomoTimeout = undefined;
  Bangle.removeListener("touch", onTouch);
  Bangle.removeListener("charging", draw);
}

function onTouch(btn, xy) {
  if (!xy || xy.y < BTN_Y - 8) return;
  const i = Math.min(3, Math.floor((xy.x * 4) / W));
  [togglePlay, togglePomo, startVoice, openAdd][i]();
}

Bangle.setUI({
  mode: "clock",
  remove: () => {
    if (drawTimeout) clearTimeout(drawTimeout);
    drawTimeout = undefined;
    if (pomoTimeout) clearTimeout(pomoTimeout);
    Bangle.removeListener("touch", onTouch);
    Bangle.removeListener("charging", draw);
  },
});
Bangle.on("touch", onTouch);
Bangle.on("charging", draw);
armPomo();
Bangle.loadWidgets();
draw();
Bangle.drawWidgets();
}
