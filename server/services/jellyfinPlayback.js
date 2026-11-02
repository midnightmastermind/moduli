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

export async function playInfo({ cfg, itemId, userId }) {
  const playSessionId = crypto.randomUUID();
  const openUrl = openUrlOf(cfg, itemId);
  let item;
  try {
    const r = await jellyfinFetch(cfg, `/Users/${encodeURIComponent(cfg.userId)}/Items/${encodeURIComponent(itemId)}`);
    if (r.status === 404) return { playable: false };
    if (!r.ok) return { offline: true, playable: true, openUrl, error: `jellyfin_${r.status}` };
    item = await r.json().catch(() => ({}));
  } catch (e) {
    if (isOffline(e)) return { offline: true, playable: true, openUrl };
    throw e;
  }
  const id = encodeURIComponent(itemId);
  sessions.set(playSessionId, { started: false, itemId, userId, at: Date.now() });
  prune();
  return {
    playable: true,
    playSessionId,
    // VideoBitrate is what makes Jellyfin transcode: with MaxStreamingBitrate alone it stream-copied an h264 source
    // (Brightburn: 1080p, ~19 MB per 6s segment, 2026-11-02) — slower than real time over the PC's 9.6 Mbps upload.
    hlsUrl: `${PROXY}/Videos/${id}/master.m3u8?MediaSourceId=${id}&VideoCodec=h264&AudioCodec=aac&VideoBitrate=3500000&AudioBitrate=128000&MaxStreamingBitrate=4000000&PlaySessionId=${encodeURIComponent(playSessionId)}`,
    directUrl: `${PROXY}/Videos/${id}/stream?static=true&MediaSourceId=${id}`,
    resumeSeconds: (Number(item?.UserData?.PlaybackPositionTicks) || 0) / TICKS,
    runtimeSeconds: (Number(item?.RunTimeTicks) || 0) / TICKS,
    openUrl,
  };
}

const post = (cfg, path, body) => jellyfinFetch(cfg, path, {
  method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
});

export async function reportProgress({ cfg, itemId, userId, seconds, paused, playSessionId }) {
  const sid = String(playSessionId || "");
  const body = { ItemId: itemId, MediaSourceId: itemId, PlaySessionId: sid, PositionTicks: Math.round((Number(seconds) || 0) * TICKS), IsPaused: !!paused, CanSeek: true };
  const s = sessions.get(sid);
  if (!s || s.userId !== userId || s.itemId !== itemId) return { ok: false, unknownSession: true };
  try {
    s.at = Date.now();
    if (!s.started) {
      s.started = true; // before the await: a second report arriving meanwhile must not send "start" again
      try { await post(cfg, "/Sessions/Playing", body); } catch (e) { s.started = false; throw e; }
    }
    await post(cfg, "/Sessions/Playing/Progress", body);
    // The session reports run under the admin key, whose session has no user, so Jellyfin keeps no resume point
    // from them (12.4.0, measured 2026-11-02). The owner's UserData is written directly.
    await post(cfg, `/UserItems/${encodeURIComponent(itemId)}/UserData?userId=${encodeURIComponent(cfg.userId)}`, { PlaybackPositionTicks: body.PositionTicks });
    return { ok: true };
  } catch (e) {
    if (isOffline(e)) return { ok: false, offline: true };
    throw e;
  }
}

export async function markPlayed({ cfg, itemId, userId, playSessionId }) {
  try {
    const sid = String(playSessionId || "");
    const s = sessions.get(sid);
    if (s && s.userId === userId && s.itemId === itemId) {
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
