// modules/PdfViewer.jsx
//
// The PDF page viewer (pdf.js), moved out of ArtifactContent so the book reader (BookReader) can host
// it too. `initialPage` opens at a page; `onPage(pageNum, doc)` reports the page on screen and the
// loaded pdf.js document, which is what the reader's Magic and Save page read the text from.
import { useEffect, useRef, useState } from "react";

// PDF viewer (files audit gap #9). Lazy-loads pdfjs-dist (~800KB) so the
// app's first-load cost is zero for users who never open a PDF. Renders
// each page on demand into a canvas; navigation via prev/next buttons +
// page-number input. Falls back to a plain `<iframe>` while the module
// loads OR if pdfjs throws — better to show *something* than a blank.
export default function PdfViewer({ src, title, initialPage = 1, onPage = null, controlRef = null, onState = null }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const pdfDocRef = useRef(null);
  const renderTaskRef = useRef(null);
  const [pdfjs, setPdfjs] = useState(null);
  const [totalPages, setTotalPages] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [error, setError] = useState(null);
  const [zoom, setZoom] = useState(1.2);
  // Read once, when the document loads — a later change of `initialPage` (the reader saving the
  // position it was just told about) must not move the page out from under the reader.
  const initialPageRef = useRef(initialPage);
  const onPageRef = useRef(onPage);
  onPageRef.current = onPage;
  useEffect(() => {
    const doc = pdfDocRef.current;
    if (doc && totalPages > 0) onPageRef.current?.(pageNum, doc);
  }, [pageNum, totalPages]);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;
  useEffect(() => { onStateRef.current?.({ pageNum, totalPages, zoom }); }, [pageNum, totalPages, zoom]);

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
      const start = Math.floor(Number(initialPageRef.current) || 1);
      setPageNum(Math.min(Math.max(1, start), doc.numPages || 1));
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
  const zoomBy = (d) => setZoom((z) => Math.min(3, Math.max(0.4, +(z + d).toFixed(2))));
  // The book reader draws this viewer's controls in its own header row (one row, user 2026-10-18).
  if (controlRef) controlRef.current = { go, jump, zoomBy };

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", overflow: "auto", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: 16, background: "#000", boxSizing: "border-box" }}>
      {pdfjs && totalPages > 0 ? (
        // The page on a white sheet with a margin of its own (user, 2026-10-18).
        <div className="book-sheet" style={{ background: "#fff", padding: 24, boxShadow: "var(--menu-shadow-1)", lineHeight: 0 }}>
          <canvas ref={canvasRef} style={{ background: "white" }} />
        </div>
      ) : (
        <div style={{ color: "var(--text-faint)", fontFamily: "var(--font-mono)", fontSize: 12, padding: 32 }}>
          Loading PDF…
        </div>
      )}
    </div>
  );
}
