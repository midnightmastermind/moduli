// extension/popup.js — the toolbar button's menu. The two page clips from the
// right-click menu, run through the SAME background handler (see clip.js
// POPUP_ACTIONS): the popup only says which one and for which tab.
import { POPUP_ACTIONS, clippableUrl } from "./clip.js";

const api = globalThis.browser ?? globalThis.chrome;
const [tab] = await api.tabs.query({ active: true, currentWindow: true });
const actions = document.getElementById("actions");
const note = document.getElementById("note");

if (!clippableUrl(tab?.url)) {
  note.hidden = false;
  note.textContent = "Open a web page to clip it. (Pages like new tabs and settings can't be clipped.)";
} else {
  for (const a of POPUP_ACTIONS) {
    const b = document.createElement("button");
    b.className = "clip";
    b.innerHTML = `<b></b><small></small>`;
    b.querySelector("b").textContent = a.label;
    b.querySelector("small").textContent = a.hint;
    b.addEventListener("click", async () => {
      await api.runtime.sendMessage({ type: "moduli-clip", menuItemId: a.id, tab: { url: tab.url, title: tab.title, id: tab.id } });
      window.close();
    });
    actions.appendChild(b);
  }
}

document.getElementById("settings").addEventListener("click", (e) => {
  e.preventDefault();
  api.runtime.openOptionsPage();
  window.close();
});
