// helpers/jellyfinPlay.js — the pure half of playing a Jellyfin-linked instance in Moduli, plus the one
// open-the-player entry point (a host mounted once in App, ui/JellyfinPlayerHost).
//
// An instance is playable when the sync linked it (`meta.jellyfinId`, server/services/jellyfinSync). The
// server answers GET /api/v1/jellyfin/play/:occId with proxy-relative stream urls; <video> and hls.js
// cannot send an Authorization header, so the session token rides as `t=` (the proxy lifts it).
import { Play, ExternalLink } from "lucide-react";
import { sessionHeaders } from "./authStorage";

/** "Finished" = the position reached 90% of the runtime (global constraint). */
export const FINISHED_FRACTION = 0.9;

export const OFFLINE_COPY = "Media server is offline — the PC may be asleep.";

export function isPlayableRow(occ) {
  return !!occ?.meta?.jellyfinId;
}

export function shouldMarkFinished(seconds, runtime) {
  const r = Number(runtime);
  if (!Number.isFinite(r) || r <= 0) return false;
  return Number(seconds) >= r * FINISHED_FRACTION;
}

/** YYYY-MM-DD of the BROWSER's local day (Last Watched is a date-only field). */
export function localDateString(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function withMediaToken(url, token) {
  if (!url || !token) return url;
  return `${url}${url.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}`;
}

/** The grid's Last Watched + Watched At fields, found by name (never by id). */
export function findWatchFields(fieldsById) {
  const all = Object.values(fieldsById || {});
  const byName = (n) => all.find((f) => f?.name === n) || null;
  return { lastWatched: byName("Last Watched"), watchedAt: byName("Watched At") };
}

/** The instance's whole field map with the two watch fields set (the server shallow-merges `fields`). */
export function buildWatchedFields(currentFields, { lastWatched, watchedAt }, now = new Date()) {
  const fields = { ...(currentFields || {}) };
  if (lastWatched?.id) fields[lastWatched.id] = { ...(fields[lastWatched.id] || {}), value: localDateString(now) };
  if (watchedAt?.id) fields[watchedAt.id] = { ...(fields[watchedAt.id] || {}), value: now.toISOString() };
  return fields;
}

// ── fetches ────────────────────────────────────────────────────────────────
const JSON_HEADERS = () => ({ "content-type": "application/json", ...sessionHeaders() });

export async function fetchPlayInfo(occId) {
  const r = await fetch(`/api/v1/jellyfin/play/${encodeURIComponent(occId)}`, { headers: sessionHeaders() });
  if (r.status === 401) return { unauthorized: true };
  if (!r.ok) return { playable: false, error: `http_${r.status}` };
  return r.json();
}

export function postJson(path, body, { keepalive = false } = {}) {
  return fetch(path, { method: "POST", headers: JSON_HEADERS(), body: JSON.stringify(body), keepalive });
}

/** Radial "Open in Jellyfin": the url comes from the server (the public url is server config). */
export async function openInJellyfin(occId) {
  // Opened before the await so the browser does not treat it as an unrequested popup.
  const win = typeof window !== "undefined" ? window.open("", "_blank") : null;
  try {
    const info = await fetchPlayInfo(occId);
    if (info?.openUrl && win) { win.opener = null; win.location.href = info.openUrl; return; }
  } catch { /* fall through */ }
  win?.close();
}

// ── the player host ──────────────────────────────────────────────────────────
let hostListener = null;
export function registerJellyfinPlayerHost(fn) {
  hostListener = fn;
  return () => { if (hostListener === fn) hostListener = null; };
}

/** Open the player for an instance. `ctx` = { dispatch, socket, getOcc, getFieldMap } of the caller's grid. */
export function openJellyfinPlayer({ occurrence, label, ...ctx }) {
  if (!isPlayableRow(occurrence)) return false;
  if (!hostListener) { console.warn("[JellyfinPlayer] no host mounted — is <JellyfinPlayerHost/> in App?"); return false; }
  hostListener({ occurrenceId: occurrence.id, label: label || occurrence.label || "", ...ctx });
  return true;
}

/** The radial items: Play + Open in Jellyfin, folded into one "Jellyfin" submenu. Nothing without a jellyfinId. */
export function jellyfinRadialItems({ occurrence, onPlay }) {
  if (!isPlayableRow(occurrence)) return [];
  const group = { group: "Jellyfin", groupIcon: Play, groupColor: "bg-slate-700 hover:bg-slate-600" };
  return [
    { icon: Play, label: "Play", color: "bg-slate-700 hover:bg-slate-600", onClick: () => onPlay?.(), ...group },
    { icon: ExternalLink, label: "Open in Jellyfin", color: "bg-slate-700 hover:bg-slate-600",
      onClick: () => openInJellyfin(occurrence.id), ...group },
  ];
}
