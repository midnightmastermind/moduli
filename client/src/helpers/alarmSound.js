// helpers/alarmSound.js
// Synthesized alarm ring — WebAudio oscillator beeps, no audio asset to load
// or cache-bust. Classic two-tone digital alarm: 4 bursts of paired beeps,
// repeated for ~6s. Safe to call from anywhere (no-ops when AudioContext is
// unavailable or blocked by autoplay policy — the notification still shows).
let _ctx = null;

function ctx() {
  if (_ctx) return _ctx;
  const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  _ctx = new AC();
  return _ctx;
}

function beep(ac, at, freq, dur = 0.09, gainPeak = 0.22) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gainPeak, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

export function ringAlarm({ bursts = 8 } = {}) {
  const ac = ctx();
  if (!ac) return false;
  // Autoplay policy: resume() succeeds when the tab has had ANY user gesture
  // this session (true for a running workspace); if it stays suspended the
  // schedule below simply never sounds — the visual notification carries it.
  try { ac.resume?.(); } catch { /* visual notification still shows */ }
  const t0 = ac.currentTime + 0.05;
  for (let b = 0; b < bursts; b++) {
    const base = t0 + b * 0.75;
    // beep-beep pair per burst, alternating pitch like a digital clock
    beep(ac, base, 1568);         // G6
    beep(ac, base + 0.14, 1568);
    beep(ac, base + 0.32, 2093);  // C7
    beep(ac, base + 0.46, 2093);
  }
  return true;
}
