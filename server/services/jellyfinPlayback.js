// services/jellyfinPlayback.js — play info, progress and played for a row linked to a Jellyfin item.
// Only the owner's configured Jellyfin user (cfg.userId) is ever used; nothing about the Jellyfin user comes from a request.
import crypto from "node:crypto";
import { jellyfinFetch } from "./jellyfinConfig.js";

const TICKS = 1e7;
const SESSION_TTL_MS = 6 * 3600 * 1000;
const SESSION_MAX = 500;
const PROXY = "/api/v1/jellyfin/media";

// playSessionId -> { started, itemId, userId, at }. In memory: a restart just re-sends "start".
const sessions = new Map();
function prune(now = Date.now()) {
  for (const [k, v] of sessions) if (now - v.at > SESSION_TTL_MS) sessions.delete(k);
  while (sessions.size > SESSION_MAX) sessions.delete(sessions.keys().next().value);
}
export const _sessionCount = () => sessions.size;

const openUrlOf = (cfg, id) => `${String(cfg.publicUrl || "").replace(/\/+$/, "")}/web/#/details?id=${encodeURIComponent(id)}`;
const isOffline = (e) => e?.code === "media_offline";

/** The row's Jellyfin id when it is the requesting user's own linked row, else null. */
export async function linkedItemId(Occurrence, userId, occId) {
  if (!occId) return null;
  const occ = await Occurrence.findOne({ id: String(occId), userId }).lean();
  const id = occ?.meta?.jellyfinId;
  return typeof id === "string" && id ? id : null;
}

export async function playInfo({ cfg, itemId }) {
  const playSessionId = crypto.randomUUID();
  const openUrl = openUrlOf(cfg, itemId);
  let item;
  try {
    const r = await jellyfinFetch(cfg, `/Users/${encodeURIComponent(cfg.userId)}/Items/${encodeURIComponent(itemId)}`);
    item = r.ok ? await r.json().catch(() => ({})) : {};
  } catch (e) {
    if (isOffline(e)) return { offline: true, playable: true, openUrl };
    throw e;
  }
  const id = encodeURIComponent(itemId);
  sessions.set(playSessionId, { started: false, itemId, at: Date.now() });
  prune();
  return {
    playable: true,
    playSessionId,
    hlsUrl: `${PROXY}/Videos/${id}/master.m3u8?MediaSourceId=${id}&VideoCodec=h264&AudioCodec=aac&MaxStreamingBitrate=4000000`,
    directUrl: `${PROXY}/Videos/${id}/stream?static=true&MediaSourceId=${id}`,
    resumeSeconds: (Number(item?.UserData?.PlaybackPositionTicks) || 0) / TICKS,
    runtimeSeconds: (Number(item?.RunTimeTicks) || 0) / TICKS,
    openUrl,
  };
}

const post = (cfg, path, body) => jellyfinFetch(cfg, path, {
  method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
});

export async function reportProgress({ cfg, itemId, seconds, paused, playSessionId }) {
  const sid = String(playSessionId || "");
  const body = { ItemId: itemId, MediaSourceId: itemId, PlaySessionId: sid, PositionTicks: Math.round((Number(seconds) || 0) * TICKS), IsPaused: !!paused, CanSeek: true };
  try {
    let s = sessions.get(sid);
    if (!s) { s = { started: false, itemId, at: Date.now() }; sessions.set(sid, s); prune(); }
    s.at = Date.now();
    if (!s.started) { await post(cfg, "/Sessions/Playing", body); s.started = true; }
    await post(cfg, "/Sessions/Playing/Progress", body);
    return { ok: true };
  } catch (e) {
    if (isOffline(e)) return { ok: false, offline: true };
    throw e;
  }
}

export async function markPlayed({ cfg, itemId, playSessionId }) {
  try {
    const sid = String(playSessionId || "");
    const s = sessions.get(sid);
    if (s) {
      sessions.delete(sid);
      await post(cfg, "/Sessions/Playing/Stopped", { ItemId: itemId, MediaSourceId: itemId, PlaySessionId: sid }).catch((e) => { if (isOffline(e)) throw e; });
    }
    const r = await post(cfg, `/Users/${encodeURIComponent(cfg.userId)}/PlayedItems/${encodeURIComponent(itemId)}`);
    return { ok: r.ok };
  } catch (e) {
    if (isOffline(e)) return { ok: false, offline: true };
    throw e;
  }
}
