// ui/JellyfinPlayer.jsx — plays a Jellyfin-linked instance in Moduli (lazy: loaded only when Play is pressed,
// so hls.js stays out of the main bundle; it is imported only when the browser cannot play HLS itself).
//
// On load: GET /api/v1/jellyfin/play/:occId, seek to resumeSeconds. While playing: progress every 10s and on
// pause/end. The first time the position reaches 90% of the runtime: Last Watched (local date) + Watched At
// (ISO instant) are written in ONE "Watched" action and POST /played — once per play. Closing mid-film sends a
// final paused progress with keepalive. A progress refused for an unknown session (the server restarted) gets a
// fresh session from GET /play and is retried once.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { withAction } from "../helpers/actionScope";
import { readToken } from "../helpers/authStorage";
import {
  OFFLINE_COPY, shouldMarkFinished, withMediaToken, findWatchFields, buildWatchedFields, fetchPlayInfo, postJson,
} from "../helpers/jellyfinPlay";

const PROGRESS_EVERY_MS = 10000;
const HLS_MIME = "application/vnd.apple.mpegurl";

export default function JellyfinPlayer({ occurrenceId, label, onClose, getOcc, getFieldMap, dispatch, socket }) {
  const [info, setInfo] = useState(null);
  const [problem, setProblem] = useState(null); // "offline" | "signin" | "unplayable" | "failed"
  const videoRef = useRef(null);
  const sessionRef = useRef(null);
  const finishedRef = useRef(false);
  // Started = the resume seek applied, or the position moved past 0. Until then (and after an error) no
  // progress is sent: a report of 0 would wipe Jellyfin's resume point.
  const startedRef = useRef(false);
  const erroredRef = useRef(false);
  const refreshRef = useRef(null); // one in-flight /play re-fetch, shared by concurrent reports

  useEffect(() => {
    let alive = true;
    if (!readToken()) { setProblem("signin"); return undefined; }
    fetchPlayInfo(occurrenceId).then((r) => {
      if (!alive) return;
      if (r?.unauthorized) setProblem("signin");
      else if (r?.offline) { setInfo(r); setProblem("offline"); }
      else if (!r?.playable) setProblem("unplayable");
      else { sessionRef.current = r.playSessionId; setInfo(r); }
    }).catch(() => { if (alive) setProblem("offline"); });
    return () => { alive = false; };
  }, [occurrenceId]);

  const freshSession = useCallback((staleId) => {
    if (!refreshRef.current) {
      refreshRef.current = fetchPlayInfo(occurrenceId)
        .then((fresh) => { if (fresh?.playSessionId && sessionRef.current === staleId) sessionRef.current = fresh.playSessionId; })
        .catch(() => {})
        .finally(() => { refreshRef.current = null; });
    }
    return refreshRef.current;
  }, [occurrenceId]);

  const sendProgress = useCallback(async (video, paused, { keepalive = false, retried = false } = {}) => {
    if (!startedRef.current || erroredRef.current || finishedRef.current) return;
    const seconds = Number(video?.currentTime);
    if (!sessionRef.current || !Number.isFinite(seconds) || seconds < 0) return;
    const sid = sessionRef.current;
    const body = { occId: occurrenceId, seconds, paused: !!paused, playSessionId: sid };
    try {
      const r = await postJson("/api/v1/jellyfin/progress", body, { keepalive });
      if (r.status === 400 && !keepalive && !retried) {
        const out = await r.json().catch(() => ({}));
        // Only an unknown session (the server restarted) is worth a fresh one; any other 400 is final.
        if (!/playSessionId/i.test(String(out?.message || ""))) return;
        await freshSession(sid);
        if (sessionRef.current !== sid) await sendProgress(video, paused, { retried: true });
      }
    } catch { /* a lost report costs at most the last 10s of position */ }
  }, [occurrenceId, freshSession]);

  const markWatched = useCallback(async () => {
    const watch = findWatchFields(getFieldMap?.() || {});
    if (watch.lastWatched) {
      const occ = getOcc?.(occurrenceId) || { id: occurrenceId };
      const fields = buildWatchedFields(occ.fields, watch);
      const triggerField = [watch.lastWatched, watch.watchedAt].filter(Boolean)
        .map((f) => ({ fieldId: f.id, value: fields[f.id].value, instanceId: occ.moduleId }));
      withAction("Watched", () => CommitHelpers.updateOccurrence({
        dispatch, socket, occurrence: { id: occurrenceId, fields }, triggerField,
      }));
    }
    try {
      const r = await postJson("/api/v1/jellyfin/played", { occId: occurrenceId, playSessionId: sessionRef.current });
      const out = await r.json().catch(() => ({}));
      if (!r.ok || !out?.ok) console.warn("[JellyfinPlayer] Jellyfin did not record the play", r.status, out);
    } catch (e) { console.warn("[JellyfinPlayer] played failed", e); }
  }, [occurrenceId, getFieldMap, getOcc, dispatch, socket]);

  // Attach the stream once the play info is in; this effect also owns the final report on close.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !info?.playable || info.offline) return undefined;
    const token = readToken();
    let hls = null;
    let cancelled = false;
    let timer = null;

    const probe401 = async () => {
      try {
        const r = await fetch(video.currentSrc || video.src, { headers: { Range: "bytes=0-0" } });
        r.body?.cancel?.();
        setProblem(r.status === 401 ? "signin" : "failed");
      } catch { setProblem("offline"); }
    };

    (async () => {
      if (video.canPlayType?.(HLS_MIME)) { video.src = withMediaToken(info.hlsUrl, token); return; }
      let Hls = null;
      try { Hls = (await import("hls.js")).default; } catch { Hls = null; }
      if (cancelled) return;
      if (Hls?.isSupported?.()) {
        hls = new Hls();
        hls.on(Hls.Events.ERROR, (_e, data) => {
          const unauthorized = data?.response?.code === 401;
          if (!unauthorized && !data?.fatal) return;
          erroredRef.current = true;
          setProblem(unauthorized ? "signin" : "failed");
          hls?.destroy?.(); // a detached instance would keep buffering
          hls = null;
        });
        hls.loadSource(withMediaToken(info.hlsUrl, token));
        hls.attachMedia(video);
      } else {
        video.src = withMediaToken(info.directUrl, token);
      }
    })();

    const onMeta = () => {
      if (info.resumeSeconds > 0) video.currentTime = info.resumeSeconds;
      startedRef.current = true;
    };
    const onPlay = () => {
      clearInterval(timer);
      if (!finishedRef.current) timer = setInterval(() => sendProgress(video, false), PROGRESS_EVERY_MS);
    };
    const onPause = () => { clearInterval(timer); sendProgress(video, true); };
    const onTime = () => {
      if (finishedRef.current) return;
      if (Number(video.currentTime) > 0) startedRef.current = true;
      const runtime = info.runtimeSeconds || video.duration;
      if (shouldMarkFinished(video.currentTime, runtime)) {
        finishedRef.current = true;
        clearInterval(timer); // /played ends the session; further reports would only 400
        markWatched();
      }
    };
    const onError = () => { erroredRef.current = true; clearInterval(timer); if (!hls) probe401(); };
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onPause);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("error", onError);
    return () => {
      cancelled = true;
      clearInterval(timer);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onPause);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("error", onError);
      // Closed mid-film: save the position (sendProgress skips it before a start, after an error or a finish).
      sendProgress(video, true, { keepalive: true });
      hls?.destroy?.();
    };
  }, [info, sendProgress, markWatched]);

  const msg = (text) => <div style={{ padding: 24, color: "var(--text-primary)", fontSize: 14 }}>{text}</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", color: "var(--text-primary)" }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
        <button type="button" aria-label="Close player" onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", lineHeight: 0, padding: 4 }}>
          <X size={16} />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--viewer-bg)" }}>
        {problem === "offline" ? (
          <div style={{ padding: 24, color: "var(--text-primary)", fontSize: 14, display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
            <div>{OFFLINE_COPY}</div>
            {info?.openUrl && <a href={info.openUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>Open in Jellyfin</a>}
          </div>
        ) : problem === "signin" ? msg("Your session has expired — Sign in again to play this.")
          : problem === "unplayable" ? msg("This instance is not linked to anything in Jellyfin.")
          : problem === "failed" ? msg("Could not play this file.")
          : !info ? msg("Loading…")
          : <video ref={videoRef} controls autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "contain" }} />}
      </div>
    </div>
  );
}
