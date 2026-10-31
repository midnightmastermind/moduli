// A tab left open overnight wakes up on yesterday (user, 2026-10-31: "i came back to the page this
// morning with the last update being like at 8pm the night before and it didnt do anything till i
// reloaded"). The browser had put the tab to sleep — prod's log shows its socket sent nothing for
// 11h — so no timer ran, and the load-time ops that move the date to today (Grid: Snap Filter To
// Today) and build today's columns only run on a LOAD. When the calendar day changes under an open
// tab, reload it: a reload is exactly the "first load of the day" those ops are written for.
// Checked when the tab wakes or comes back into view, and once a minute; never while the user is
// typing (the next check catches it).
const KEY = "moduli-day-rollover-reload";

export function localDayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Reload when the day the page loaded on is no longer today, unless the user is typing, and at most
 *  once per new day (a clock that disagrees with itself cannot reload-loop). */
export function shouldReloadForNewDay({ loadedDay, today, editing, lastReloadDay }) {
  if (!loadedDay || !today || loadedDay === today) return false;
  if (editing) return false;
  return lastReloadDay !== today;
}

export function isEditingElement(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el.isContentEditable;
}

export function installDayRolloverReload(win = window, doc = document) {
  if (!win || !doc || win.ModuliNative) return () => {}; // the headset's windows manage themselves
  const loadedDay = localDayKey();
  const check = () => {
    let last = null;
    try { last = win.sessionStorage.getItem(KEY); } catch { /* storage blocked */ }
    const today = localDayKey();
    if (!shouldReloadForNewDay({ loadedDay, today, editing: isEditingElement(doc.activeElement), lastReloadDay: last })) return;
    try { win.sessionStorage.setItem(KEY, today); } catch { /* storage blocked */ }
    win.location.reload();
  };
  const onVisible = () => { if (doc.visibilityState === "visible") check(); };
  doc.addEventListener("visibilitychange", onVisible);
  doc.addEventListener("resume", check); // a frozen tab thawing (Chromium / Edge sleeping tabs)
  win.addEventListener("pageshow", check);
  win.addEventListener("focus", check);
  const id = win.setInterval(check, 60_000);
  return () => {
    doc.removeEventListener("visibilitychange", onVisible);
    doc.removeEventListener("resume", check);
    win.removeEventListener("pageshow", check);
    win.removeEventListener("focus", check);
    win.clearInterval(id);
  };
}
