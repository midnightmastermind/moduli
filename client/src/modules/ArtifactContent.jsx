// modules/ArtifactContent.jsx
// Pure content renderer for file-backed artifact modules.
// viewType: "markdown" → TipTap Editor (moduleEmbed nodes handle embedded containers inline)
// viewType: "artifact" + artifactType: "image"|"pdf"|"audio"|"video" → file renderer
// viewType: "code" → syntax-highlighted code block (fetches raw file content)
// view: passed from Panel — used to trigger scrollAnchor scroll in the editor
import { runOcr } from "../helpers/ocr";
import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useGridActions } from "../GridActionsContext.js";
import Editor from "../ui/Editor.jsx";
import { hexToRgba } from "../helpers/colorHelpers.js";
import * as CommitHelpers from "../helpers/CommitHelpers.js";
import { resolveFileRef } from "../helpers/fileRef.js";
// The global image picker (search / upload / URL). Its single host is mounted in
// App.jsx and call sites open it imperatively — the same way ui/QuickAddMenu does.
// The "Replace" button below called this WITHOUT the import, so clicking it threw
// a ReferenceError instead of opening the picker.
import { openImagePicker } from "../ui/ImagePickerMenu";
import "highlight.js/styles/atom-one-dark.css";
import { Settings, Download, ScanText, Loader2, ImagePlus } from "lucide-react";
import { toast } from "../state/notificationStore";

// Human-readable byte count. Mirrors ArtifactCard's formatBytes —
// duplicated rather than imported so each viewer surface stays
// self-contained. ~5 lines, deliberately small.
function formatBytes(bytes) {
  if (bytes == null || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

// Floating "save to disk" affordance used by the image / pdf / audio /
// video / code viewer surfaces. Click triggers a browser download under
// the original filename (not the timestamp-randomized server filename).
// Docket §8 gap #20 — page-level analog of the in-card download link
// that already lives in ArtifactCard expanded mode.
function ArtifactDownloadBadge({ fileRef, originalName, size, style }) {
  if (!fileRef) return null;
  const sizeLabel = formatBytes(size);
  return (
    <a
      href={resolveFileRef(fileRef)}
      download={originalName || ""}
      title={originalName ? `Download ${originalName}${sizeLabel ? ` (${sizeLabel})` : ""}` : "Download original"}
      style={{
        position: "absolute", top: 10, right: 10, zIndex: 5,
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "4px 10px", borderRadius: 14,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        color: "rgba(255,255,255,0.92)", textDecoration: "none",
        fontFamily: "var(--font-mono)", fontSize: 10,
        border: "1px solid rgba(255,255,255,0.18)",
        ...(style || {}),
      }}
    >
      <Download size={12} />
      <span style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {originalName || "Download"}
      </span>
      {sizeLabel && <span style={{ opacity: 0.7 }}>· {sizeLabel}</span>}
    </a>
  );
}

// PDF viewer (files audit gap #9). Lazy-loads pdfjs-dist (~800KB) so the
// app's first-load cost is zero for users who never open a PDF. Renders
// each page on demand into a canvas; navigation via prev/next buttons +
// page-number input. Falls back to a plain `<iframe>` while the module
// loads OR if pdfjs throws — better to show *something* than a blank.
function PdfViewer({ src, title }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const pdfDocRef = useRef(null);
  const renderTaskRef = useRef(null);
  const [pdfjs, setPdfjs] = useState(null);
  const [totalPages, setTotalPages] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [error, setError] = useState(null);
  const [zoom, setZoom] = useState(1.2);

  // Lazy-load pdfjs once per component lifecycle.
  useEffect(() => {
    let mounted = true;
    import("pdfjs-dist").then(async (mod) => {
      if (!mounted) return;
      // pdfjs v4+ needs a worker URL. The matching worker ships in
      // the package; we route it through Vite's `?url` import so the
      // bundler emits the right asset path. Module-level dynamic
      // import keeps it lazy alongside the main pdfjs chunk.
      try {
        const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
        mod.GlobalWorkerOptions.workerSrc = workerUrl;
      } catch {
        // Older builds expose the worker at a different path; fall
        // through silently — pdfjs falls back to inline parsing.
      }
      if (mounted) setPdfjs(() => mod);
    }).catch(() => { if (mounted) setError("pdf viewer unavailable"); });
    return () => { mounted = false; };
  }, []);

  // Load the document once pdfjs is ready.
  useEffect(() => {
    if (!pdfjs || !src) return;
    let cancelled = false;
    const loadTask = pdfjs.getDocument({ url: src });
    loadTask.promise.then((doc) => {
      if (cancelled) { try { doc.destroy(); } catch { /* ignore */ } return; }
      pdfDocRef.current = doc;
      setTotalPages(doc.numPages);
      setPageNum(1);
    }).catch((e) => { if (!cancelled) setError(String(e?.message || e || "failed to load")); });
    return () => {
      cancelled = true;
      try { loadTask.destroy(); } catch { /* ignore */ }
      try { pdfDocRef.current?.destroy(); } catch { /* ignore */ }
      pdfDocRef.current = null;
    };
  }, [pdfjs, src]);

  // Render the active page whenever it OR zoom changes. Cancels any
  // in-flight render before kicking off a new one — pdfjs throws if
  // two renders target the same canvas concurrently.
  useEffect(() => {
    const doc = pdfDocRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || pageNum < 1 || pageNum > doc.numPages) return;
    let cancelled = false;
    if (renderTaskRef.current) {
      try { renderTaskRef.current.cancel(); } catch { /* ignore */ }
    }
    doc.getPage(pageNum).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale: zoom });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const task = page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport });
      renderTaskRef.current = task;
      task.promise.catch(() => { /* cancelled or failed — UI shows the prior page */ });
    });
    return () => { cancelled = true; };
  }, [pageNum, zoom]);

  if (error) {
    // Iframe fallback — the browser's built-in PDF viewer works for
    // most users; we lose page-nav controls but at least the document
    // is visible. Same shape as the pre-pdfjs implementation.
    return (
      <iframe src={src} title={title} style={{ width: "100%", height: "100%", border: "none" }} />
    );
  }

  const go = (delta) => setPageNum((n) => Math.max(1, Math.min(totalPages || 1, n + delta)));
  const jump = (raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return;
    setPageNum(Math.min(totalPages || 1, Math.floor(n)));
  };

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--surface-low, #1a1a1a)" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
        background: "rgba(0,0,0,0.45)", color: "var(--text-muted, rgba(255,255,255,0.7))",
        fontFamily: "var(--font-mono)", fontSize: 11, flexShrink: 0,
        borderBottom: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
      }}>
        <button type="button" onClick={() => go(-1)} disabled={pageNum <= 1} style={pdfNavBtn}>←</button>
        <span>
          Page&nbsp;
          <input
            type="number"
            min={1}
            max={totalPages || 1}
            value={pageNum}
            onChange={(e) => jump(e.target.value)}
            style={{
              width: 48, padding: "1px 4px", textAlign: "center",
              background: "rgba(255,255,255,0.06)", color: "inherit",
              border: "1px solid rgba(255,255,255,0.12)", borderRadius: 4,
              fontFamily: "inherit", fontSize: 11,
            }}
          />
          &nbsp;/&nbsp;{totalPages || "?"}
        </span>
        <button type="button" onClick={() => go(1)} disabled={pageNum >= totalPages} style={pdfNavBtn}>→</button>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.2).toFixed(2)))} style={pdfNavBtn}>−</button>
        <span style={{ minWidth: 44, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2)))} style={pdfNavBtn}>+</button>
      </div>
      <div style={{ flex: 1, overflow: "auto", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: 16 }}>
        {pdfjs && totalPages > 0 ? (
          <canvas ref={canvasRef} style={{ background: "white", boxShadow: "var(--menu-shadow-1)" }} />
        ) : (
          <div style={{ color: "var(--text-faint)", fontFamily: "var(--font-mono)", fontSize: 11, padding: 32 }}>
            Loading PDF…
          </div>
        )}
      </div>
    </div>
  );
}
const pdfNavBtn = {
  padding: "2px 8px", borderRadius: 4,
  background: "rgba(255,255,255,0.06)", color: "inherit",
  border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer",
  fontFamily: "inherit", fontSize: 11,
};

// Audio waveform viewer (files audit gap #11). Lazy-loads wavesurfer.js
// — the import sits at ~150KB minified, no point paying that cost for
// users who never open an audio artifact. Plain `<audio controls>` is
// the fallback while the module loads OR if wavesurfer's `create` throws
// (rare; happens on unsupported codecs). Play/pause toggles the
// wavesurfer instance directly; seek is built-in on click.
function AudioWaveform({ src }) {
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
          height: 96,
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
  }, [src]);

  const togglePlay = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    try { ws.playPause(); } catch { /* ignore */ }
  }, []);

  return (
    <div style={{ width: "100%", maxWidth: 640, display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        ref={containerRef}
        style={{
          width: "100%", minHeight: 96,
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
            fontFamily: "var(--font-mono)", fontSize: 11,
          }}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <span style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-faint)" }}>
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

// Extension → highlight.js language id. Common cases only; anything not in
// the map falls through to highlightAuto.
const EXT_TO_LANG = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
  c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", swift: "swift",
  kt: "kotlin", scala: "scala", php: "php", pl: "perl", lua: "lua",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  json: "json", yaml: "yaml", yml: "yaml", toml: "ini", ini: "ini",
  xml: "xml", html: "xml", svg: "xml",
  css: "css", scss: "scss", sass: "scss", less: "less",
  md: "markdown", markdown: "markdown",
  sql: "sql", graphql: "graphql", dockerfile: "dockerfile",
  vue: "xml", svelte: "xml",
};

function CodeViewer({ fileRef, label, originalName, size }) {
  const [code, setCode] = useState(null);
  const [error, setError] = useState(null);
  const [hljs, setHljs] = useState(null);
  useEffect(() => {
    if (!fileRef) return;
    let mounted = true;
    fetch(resolveFileRef(fileRef))
      .then(r => r.ok ? r.text() : Promise.reject(r.status))
      .then(text => { if (mounted) setCode(text); })
      .catch(() => { if (mounted) setError("Failed to load file"); });
    return () => { mounted = false; };
  }, [fileRef]);
  useEffect(() => {
    let mounted = true;
    import("highlight.js").then((mod) => { if (mounted) setHljs(() => mod.default); });
    return () => { mounted = false; };
  }, []);
  const ext = fileRef ? fileRef.split(".").pop().toLowerCase() : "";
  const lang = EXT_TO_LANG[ext] || null;
  const highlighted = useMemo(() => {
    if (code == null || !hljs) return null;
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      return null;
    }
  }, [code, hljs, lang]);
  const sizeLabel = formatBytes(size);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {(label || fileRef) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-faint)", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {label || ""}{ext ? ` · .${ext}` : ""}{lang ? ` · ${lang}` : ""}{sizeLabel ? ` · ${sizeLabel}` : ""}
          </span>
          {fileRef && (
            <a
              href={resolveFileRef(fileRef)}
              download={originalName || ""}
              title={originalName ? `Download ${originalName}` : "Download"}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--text-muted)", textDecoration: "none", padding: "2px 6px", borderRadius: 3 }}
            >
              <Download size={11} />
              <span>Download</span>
            </a>
          )}
        </div>
      )}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
        {error ? (
          <span style={{ color: "rgba(255,80,80,0.7)", fontSize: 12, fontFamily: "var(--font-mono)" }}>{error}</span>
        ) : code == null ? (
          <span style={{ color: "var(--text-faint)", fontSize: 12, fontFamily: "var(--font-mono)" }}>Loading…</span>
        ) : (
          <pre style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.6, color: "var(--text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-all", background: "transparent" }}>
            {highlighted != null ? (
              <code className={`hljs${lang ? ` language-${lang}` : ""}`} dangerouslySetInnerHTML={{ __html: highlighted }} />
            ) : (
              <code>{code}</code>
            )}
          </pre>
        )}
      </div>
    </div>
  );
}

// OCR button rendered next to the image's download badge. On click:
//   1. Lazy-loads tesseract.js
//   2. Recognizes text from the image URL
//   3. Mints a role:"textblock" module + occurrence and appends it to the
//      image occurrence's occurrences[] so the editor renders under the media.
function OcrButton({ imageUrl, hostOccurrence, dispatch, socket, gridId, userId, style }) {
  const [running, setRunning] = useState(false);
  const handleClick = useCallback(async (e) => {
    e.preventDefault();
    if (running || !imageUrl || !hostOccurrence || !gridId || !userId) return;
    setRunning(true);
    const toastId = toast.loading("Running OCR…");
    try {
      const text = await runOcr(imageUrl, (m) => {
        if (m?.status === "recognizing text" && typeof m.progress === "number") {
          toast.loading(`OCR · ${Math.round(m.progress * 100)}%`, { id: toastId });
        }
      });
      if (!text) {
        toast.warning("OCR finished — no text detected", { id: toastId });
        return;
      }
      // Build TipTap textmap: one paragraph per non-empty line of OCR output.
      const paragraphs = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
      const textmap = {
        type: "doc",
        content: paragraphs.length > 0
          ? paragraphs.map(line => ({ type: "paragraph", content: [{ type: "text", text: line }] }))
          : [{ type: "paragraph" }],
      };
      // Mint textblock module + occurrence with the OCR'd content inline,
      // then append to the image's occurrences[] (multi-child membership).
      const moduleId = crypto?.randomUUID?.() || `tb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const occurrenceId = crypto?.randomUUID?.() || `to-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const newModule = { id: moduleId, userId, gridId, role: "textblock", kind: "doc", label: "OCR" };
      const newOccurrence = { id: occurrenceId, userId, gridId, moduleId, parentId: hostOccurrence.id, textmap };
      CommitHelpers.createModule({ dispatch, socket, module: newModule, emit: true });
      CommitHelpers.createOccurrence({ dispatch, socket, occurrence: newOccurrence, emit: true });
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: { id: hostOccurrence.id, occurrences: [...(hostOccurrence.occurrences || []), occurrenceId] },
        emit: true,
      });
      toast.success(`OCR · ${paragraphs.length} line${paragraphs.length === 1 ? "" : "s"} extracted`, { id: toastId });
    } catch (err) {
      console.error("[OCR] error:", err);
      toast.error(`OCR failed: ${err.message || "unknown error"}`, { id: toastId });
    } finally {
      setRunning(false);
    }
  }, [running, imageUrl, hostOccurrence, dispatch, socket, gridId, userId]);
  return (
    <button
      onClick={handleClick}
      disabled={running}
      title={running ? "OCR in progress…" : "Extract text from this image into a new textblock below"}
      style={{
        position: "absolute", top: 10, right: 220, zIndex: 5,
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "4px 10px", borderRadius: 14,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        color: "rgba(255,255,255,0.92)",
        fontFamily: "var(--font-mono)", fontSize: 10,
        border: "1px solid rgba(255,255,255,0.18)",
        cursor: running ? "wait" : "pointer", opacity: running ? 0.7 : 1,
        ...(style || {}),
      }}
    >
      {running ? <Loader2 size={12} className="animate-spin" /> : <ScanText size={12} />}
      <span>{running ? "OCR…" : "OCR"}</span>
    </button>
  );
}

export default function ArtifactContent({ occurrence, viewType, artifactType, embedded = false, dispatch, socket, view, onScrollHighlight }) {
  const { modulesById, occurrencesById, gridId, userId } = useGridActions();
  const module = occurrence?.moduleId ? modulesById?.[occurrence.moduleId] : null;
  const fileRef = module?.fileRef;
  const docAccentBg = hexToRgba(module?.ownStyle?.bg, 0.1) ?? null;
  const scrollRef = useRef(null);

  // Doc name editing state
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const nameInputRef = useRef(null);

  const handleStartRename = useCallback(() => {
    setNameValue(module?.label || "");
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.select(), 0);
  }, [module?.label]);

  const handleSaveName = useCallback(() => {
    setEditingName(false);
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== module?.label) {
      CommitHelpers.updateModule({ dispatch, socket, module: { id: module.id, label: trimmed } });
    }
  }, [nameValue, module, dispatch, socket]);

  // Normalize: if old-style viewType was image/pdf/audio/video, treat as display
  const normalizedArtifactType = artifactType
    || (["image", "pdf", "audio", "video"].includes(viewType) ? viewType : null);
  const isArtifact = viewType === "display" || normalizedArtifactType;

  // Scroll to embedded container by data-occ-id when scrollAnchor changes
  const suppressAutoSyncRef = useRef(false);
  useEffect(() => {
    if (!view?.scrollAnchor) return;
    const container = scrollRef.current;
    const target = container?.querySelector(`[data-occ-id="${view.scrollAnchor}"]`);
    if (target && container) {
      suppressAutoSyncRef.current = true;
      container.scrollTo({ top: container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top, behavior: "smooth" });
      setTimeout(() => { suppressAutoSyncRef.current = false; }, 600);
      target.classList.remove("anchor-highlight");
      void target.offsetWidth;
      target.classList.add("anchor-highlight");
      setTimeout(() => target.classList.remove("anchor-highlight"), 1200);
    }
  }, [view?.scrollAnchor]);

  // Auto-highlight sidebar anchor based on scroll position (IntersectionObserver)
  // Uses onScrollHighlight callback — does NOT modify activeOccurrenceId (which controls rendering)
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !onScrollHighlight) return;

    // Suppress for 600ms on mount — prevents firing during initial render
    suppressAutoSyncRef.current = true;
    const initTimer = setTimeout(() => { suppressAutoSyncRef.current = false; }, 600);

    let debounceTimer = null;
    let lastReportedId = null;

    const observer = new IntersectionObserver(
      (entries) => {
        if (suppressAutoSyncRef.current) return;
        let topEntry = null;
        let topY = Infinity;
        for (const entry of entries) {
          if (entry.isIntersecting && entry.boundingClientRect.top < topY) {
            topY = entry.boundingClientRect.top;
            topEntry = entry;
          }
        }
        if (!topEntry) return;
        const occId = topEntry.target.getAttribute("data-occ-id");
        if (!occId || occId === lastReportedId) return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          lastReportedId = occId;
          onScrollHighlight(occId);
        }, 200);
      },
      { root: container, rootMargin: "-10% 0px -70% 0px", threshold: 0 }
    );

    const observe = () => {
      observer.disconnect();
      container.querySelectorAll("[data-occ-id]").forEach(el => observer.observe(el));
    };
    observe();

    const mo = new MutationObserver(observe);
    mo.observe(container, { childList: true, subtree: true });

    return () => { clearTimeout(initTimer); clearTimeout(debounceTimer); observer.disconnect(); mo.disconnect(); };
  }, [onScrollHighlight]);

  if (viewType === "code") {
    return (
      <CodeViewer
        fileRef={fileRef}
        label={module?.label}
        originalName={module?.meta?.originalName}
        size={module?.meta?.uploadSize}
      />
    );
  }

  // Default to markdown for any non-artifact view
  // Embedded containers are moduleEmbed TipTap nodes — no React elements appended after editor
  if (!isArtifact || !normalizedArtifactType) {
    const docLabel = module?.label;

    const radialItems = [
      {
        icon: Settings,
        label: "Rename",
        onClick: handleStartRename,
        color: "bg-slate-600 hover:bg-slate-500",
      },
    ];

    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden", position: "relative", padding: "0px 3px 3px 3px", ...(docAccentBg ? { background: docAccentBg } : {}) }}>
        {/* Drag handle — outside bordered div so overflow:hidden doesn't clip it */}


        {/* Doc card with border */}
        <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", border: "1px solid var(--border-subtle)", borderRadius: 4, overflow: "hidden" }}>

          {/* Rename input — appears below handle when editing */}
          {editingName && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
              <input
                ref={nameInputRef}
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onBlur={handleSaveName}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveName(); if (e.key === "Escape") setEditingName(false); }}
                style={{
                  background: "var(--input-bg)", border: "1px solid var(--border-default)",
                  borderRadius: 3, padding: "2px 8px", fontSize: 11, fontFamily: "var(--font-mono)",
                  color: "var(--text-primary)", outline: "none", flex: 1,
                }}
                placeholder="Document name"
                autoFocus
              />
            </div>
          )}

          {/* Doc label badge — top right */}
          {docLabel && !editingName && (
            <div style={{ position: "absolute", top: 2, right: 10, zIndex: 10, fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-faint)", userSelect: "none", pointerEvents: "none", letterSpacing: "0.03em" }}>
              {docLabel}
            </div>
          )}

          <div ref={scrollRef} className="artifact-markdown" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
            <Editor
              occurrence={occurrence}
              content={occurrence?.textmap && typeof occurrence.textmap === "object" ? occurrence.textmap : null}
              dispatch={dispatch}
              socket={socket}
              placeholder="Start writing…"
            />
          </div>
        </div>
      </div>
    );
  }

  const originalName = module?.meta?.originalName || module?.label || null;
  const uploadSize = module?.meta?.uploadSize;

  if (normalizedArtifactType === "image" && fileRef) {
    const childOccIds = Array.isArray(occurrence?.occurrences) ? occurrence.occurrences : [];
    const childTextblocks = childOccIds
      .map(id => occurrencesById?.[id])
      .filter(o => o && modulesById?.[o.moduleId]?.role === "textblock");
    const imgSrc = resolveFileRef(fileRef);
    return (
      <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%", overflow: "auto" }}>
        {/* Media — flex:0 so it sizes to its natural height; child textblocks
            stack underneath instead of being pushed off-screen. */}
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, flex: "0 0 auto" }}>
          <img
            src={imgSrc}
            alt={module?.label || fileRef}
            style={{ maxWidth: "100%", maxHeight: "min(70vh, 800px)", objectFit: "contain" }}
          />
          <ArtifactDownloadBadge fileRef={fileRef} originalName={originalName} size={uploadSize} />
          <OcrButton
            imageUrl={imgSrc}
            hostOccurrence={occurrence}
            dispatch={dispatch} socket={socket}
            gridId={gridId} userId={userId}
          />
          {/* Replace image — search / upload / URL via the global picker.
              The pick rewrites module.fileRef, so every placement of this
              artifact updates. */}
          <button
            onClick={(e) => {
              e.preventDefault();
              openImagePicker({
                query: module?.label || originalName || "",
                title: `Replace image — ${module?.label || originalName || "artifact"}`,
                onPick: (url) => {
                  CommitHelpers.updateModule({ dispatch, socket, module: { ...module, fileRef: url }, emit: true });
                },
              });
            }}
            title="Replace this image (search the web, upload, or paste a URL)"
            style={{
              position: "absolute", top: 10, right: 290, zIndex: 5,
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "4px 10px", borderRadius: 14,
              background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              color: "rgba(255,255,255,0.92)",
              fontFamily: "var(--font-mono)", fontSize: 10,
              border: "1px solid rgba(255,255,255,0.18)",
              cursor: "pointer",
            }}
          >
            <ImagePlus size={12} />
            <span>Replace</span>
          </button>
        </div>
        {/* OCR result(s) — one editable textblock per OCR run. */}
        {childTextblocks.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 16px 16px 16px", borderTop: "1px solid var(--border-subtle)" }}>
            {childTextblocks.map(tbOcc => (
              <div key={tbOcc.id} style={{ padding: "8px 0" }}>
                <Editor
                  occurrence={tbOcc}
                  content={tbOcc.textmap && typeof tbOcc.textmap === "object" ? tbOcc.textmap : null}
                  dispatch={dispatch}
                  socket={socket}
                  placeholder="Extracted text…"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (normalizedArtifactType === "pdf" && fileRef) {
    return (
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <PdfViewer src={resolveFileRef(fileRef)} title={module?.label} />
        <ArtifactDownloadBadge fileRef={fileRef} originalName={originalName} size={uploadSize} />
      </div>
    );
  }

  if (normalizedArtifactType === "audio" && fileRef) {
    return (
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: 24 }}>
        <AudioWaveform src={resolveFileRef(fileRef)} />
        <ArtifactDownloadBadge fileRef={fileRef} originalName={originalName} size={uploadSize} />
      </div>
    );
  }

  if (normalizedArtifactType === "video" && fileRef) {
    return (
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", height: "100%", overflow: "hidden", padding: 16 }}>
        <video
          src={resolveFileRef(fileRef)}
          controls
          style={{ maxWidth: "100%", maxHeight: "100%" }}
        />
        <ArtifactDownloadBadge fileRef={fileRef} originalName={originalName} size={uploadSize} />
      </div>
    );
  }

  // No fileRef or unknown type
  return (
    <div style={{ padding: 24, color: "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
      {fileRef ? `Unknown artifact type: ${normalizedArtifactType}` : "No file attached"}
    </div>
  );
}
