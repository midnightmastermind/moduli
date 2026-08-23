// extension/options.js — read and write the four settings. No decisions here;
// `settings.js` owns validation and is tested.
import { SETTINGS_KEYS, validateSettings } from "./settings.js";

const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const status = $("status");

api.storage.sync.get(SETTINGS_KEYS).then((s) => {
  for (const k of SETTINGS_KEYS) if (s[k]) $(k).value = s[k];
});

$("save").addEventListener("click", async () => {
  const raw = Object.fromEntries(SETTINGS_KEYS.map((k) => [k, $(k).value]));
  const check = validateSettings(raw);
  // Saved either way: a half-filled form should not lose what was typed. The
  // message is what tells the user it will not clip yet.
  await api.storage.sync.set(check.ok ? check.settings : raw);
  status.textContent = check.ok ? "Saved." : check.message;
  status.style.color = check.ok ? "#177245" : "#a33";
});
