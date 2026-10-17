import { useCallback, useEffect, useRef, useState } from "react";

// Audio waveform viewer (files audit gap #11). Lazy-loads wavesurfer.js
// — the import sits at ~150KB minified, no point paying that cost for
// users who never open an audio artifact. Plain `<audio controls>` is
// the fallback while the module loads OR if wavesurfer's `create` throws
// (rare; happens on unsupported codecs). Play/pause toggles the
// wavesurfer instance directly; seek is built-in on click.
export default function AudioWaveform({ src, fill = false }) {
  const containerRef = useRef(null);
  const wsRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!src || !containerRef.current) return;
    let mounted = true;
    let ws = null;
    import("wavesurfer.js").then(({ default: WaveSurfer }) => {
      if (!mounted || !containerRef.current) return;
      try {
        ws = WaveSurfer.create({
          container: containerRef.current,
          // Theme-matched colors — moduli's dark accent for the unplayed
          // waveform, brighter blue for played progress. Cursor stays
          // light so it's visible on dark surfaces.
          waveColor: "rgba(120,150,180,0.55)",
          progressColor: "rgb(96,165,250)",
          cursorColor: "rgba(255,255,255,0.75)",
          // fill: the waveform takes the height its box has (the viewer tile).
          height: fill ? "auto" : 96,
          barWidth: 2,
          barGap: 1,
          barRadius: 2,
          url: src,
        });
        ws.on("ready", () => { if (mounted) setReady(true); });
        ws.on("play",  () => { if (mounted) setPlaying(true); });
        ws.on("pause", () => { if (mounted) setPlaying(false); });
        ws.on("finish", () => { if (mounted) setPlaying(false); });
        ws.on("error", (e) => { if (mounted) setError(String(e?.message || e || "playback error")); });
        wsRef.current = ws;
      } catch (e) {
        if (mounted) setError(String(e?.message || e || "init failed"));
      }
    }).catch(() => { if (mounted) setError("waveform unavailable"); });
    return () => {
      mounted = false;
      try { ws?.destroy(); } catch { /* ignore */ }
      wsRef.current = null;
    };
  }, [src, fill]);

  const togglePlay = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    try { ws.playPause(); } catch { /* ignore */ }
  }, []);

  return (
    <div className="audio-waveform" style={{ width: "100%", maxWidth: 640, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
      <div
        ref={containerRef}
        style={{
          width: "100%", minHeight: 96,
          ...(fill ? { flex: "1 1 auto" } : null),
          background: "rgba(255,255,255,0.03)",
          borderRadius: 6,
          border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          type="button"
          onClick={togglePlay}
          disabled={!ready || !!error}
          style={{
            padding: "6px 16px", borderRadius: 6,
            background: ready && !error ? "rgb(96,165,250)" : "rgba(255,255,255,0.06)",
            color: ready && !error ? "white" : "var(--text-muted)",
            border: "none", cursor: ready && !error ? "pointer" : "default",
            fontFamily: "var(--font-mono)", fontSize: 12,
          }}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <span style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-faint)" }}>
          {error ? `Error: ${error}` : (ready ? "" : "Loading waveform…")}
        </span>
        {/* Native audio control as a "raw access" fallback. Useful when
            the user wants the browser's right-click → save audio /
            playback speed controls. Doesn't fight with wavesurfer because
            each owns its own MediaElement. */}
        <audio src={src} controls style={{ height: 28 }} />
      </div>
    </div>
  );
}

