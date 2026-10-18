// modules/BookReader.jsx
//
// A book file opened to read (user, 2026-10-15: "when i open to view, we have a similar view for
// browser which shows the book in normal format, and a magic button that turns that page into
// temporary occurances … with a save page button as well").
//
//   Book       the book as written. e-books (epub / mobi / azw / azw3) through foliate-js, paginated;
//              PDFs through the existing pdf.js viewer. The place you stop is stored on the file's
//              module (`meta.readingPosition`) and the book reopens there, on any device.
//   Magic      the page on screen, laid out as sections / textblocks / lists by `import_plan` —
//              planned, never written. Leaving it leaves nothing behind.
//   Open in panel  the book as its own page in a panel (user, 2026-10-16: "change save page to open
//              in panel, if i want to save the page, i can drag copy out of magic"). Hidden when the
//              reader already IS that page.
//   Save page  that page kept: `import_text` in the current mode's shape, filed in Imports, opened
//              (user, 2026-10-16: "put back in the save as page button next to open as panel").
//
// A Kindle file bought from Amazon is usually DRM-locked and cannot be opened by anything here; the
// reader reads its header first and says so instead of showing a blank page.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useGridActions } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { runDerived } from "../helpers/actionScope";
import {
  bookEngineFor, mobiDrmStatus, pdfTextToMarkdown, rangeToHtml, htmlHasText,
  makeReadingPosition, samePosition, positionLabel,
} from "../helpers/bookEngine";
import { usePlannedImport, useSaveAsPage } from "../hooks/usePlannedImport";
import { useOpenArtifactInPanel } from "../hooks/useOpenArtifactInPanel";
import { useSpreadHost } from "../helpers/spreadDock";
import { rememberViewerOrigin } from "../helpers/viewerReturn";
import { Spinner } from "@/components/ui/spinner";
import PdfViewer from "./PdfViewer.jsx";

const PagePreviewBody = React.lazy(() =>
  import("../PagePreviewApp.jsx").then((m) => ({ default: m.PagePreviewBody })),
);

const MODES = [["book", "Document"], ["magic", "Magic"]];
const TITLES = {
  book: "The book as written",
  magic: "This page laid out as sections, textblocks and lists — nothing is saved unless you press Save page or drag a piece out",
};
// How long the position must hold still before it is written (page turns come in bursts).
const POSITION_SAVE_MS = 2000;

const Waiting = ({ label }) => (
  <div style={{ height: "100%", minHeight: 200, display: "flex", flexDirection: "column", gap: 10, alignItems: "center",
    justifyContent: "center", color: "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
    <Spinner size="md" className="staged-hold-spinner" />
    <span>{label}</span>
  </div>
);
const Message = ({ children }) => (
  <div style={{ padding: 24, fontSize: 13, color: "var(--text-muted)", fontFamily: "var(--font-mono)", lineHeight: 1.5 }}>{children}</div>
);

/** The e-book half: fetch the file, refuse a DRM-locked one, mount <foliate-view>, report each page. */
function EbookView({ src, title, startCfi, onRelocate, viewRef, onToc }) {
  const hostRef = useRef(null);
  const [status, setStatus] = useState({ state: "loading" });
  const [toc, setToc] = useState([]);
  const onRelocateRef = useRef(onRelocate);
  onRelocateRef.current = onRelocate;
  const startRef = useRef(startCfi);

  useEffect(() => {
    let live = true;
    let view = null;
    (async () => {
      try {
        const res = await fetch(src, { credentials: "include" });
        if (!res.ok) throw new Error(`the file could not be fetched (${res.status})`);
        const blob = await res.blob();
        const head = new Uint8Array(await blob.slice(0, 64 * 1024).arrayBuffer());
        if (mobiDrmStatus(head) === "locked") { if (live) setStatus({ state: "drm" }); return; }
        await import("foliate-js/view.js");
        if (!live || !hostRef.current) return;
        view = document.createElement("foliate-view");
        view.style.width = "100%";
        view.style.height = "100%";
        hostRef.current.appendChild(view);
        viewRef.current = view;
        view.addEventListener("relocate", (e) => onRelocateRef.current?.(e.detail));
        await view.open(new File([blob], title || "book", { type: blob.type || "application/octet-stream" }));
        if (!live) return;
        view.renderer.setAttribute("flow", "paginated");
        view.renderer.setAttribute("max-inline-size", "720px");
        // One page at a time, at any width (user, 2026-10-16: "just show one page at a time").
        // foliate-js lays out up to 2 columns in a wide landscape box unless told otherwise.
        view.renderer.setAttribute("max-column-count", "1");
        view.renderer.setStyles?.("body { line-height: 1.5; }");
        setToc(Array.isArray(view.book?.toc) ? view.book.toc : []);
        // The white sheet around the page is the margin; foliate's own is small inside it.
        view.renderer.setAttribute("margin", "24px");
        view.renderer.setAttribute("gap", "4%");
        await view.init({ lastLocation: startRef.current || undefined });
        if (live) setStatus({ state: "ready" });
      } catch (e) {
        if (live) setStatus({ state: "error", error: e?.message || String(e) });
      }
    })();
    return () => {
      live = false;
      try { view?.close?.(); } catch { /* ignore */ }
      view?.remove();
      if (viewRef.current === view) viewRef.current = null;
    };
  }, [src, title, viewRef]);

  useEffect(() => {
    if (status.state !== "ready") return undefined;
    const onKey = (e) => {
      if (e.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      if (e.key === "ArrowLeft") viewRef.current?.goLeft();
      else if (e.key === "ArrowRight") viewRef.current?.goRight();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [status.state, viewRef]);

  // The contents list goes to the reader's header row (one row, user 2026-10-18).
  const onTocRef = useRef(onToc);
  onTocRef.current = onToc;
  useEffect(() => {
    const flat = [];
    const walk = (items, depth) => (items || []).forEach((it) => { flat.push({ label: it.label, href: it.href, depth }); walk(it.subitems, depth + 1); });
    walk(toc, 0);
    onTocRef.current?.(status.state === "ready" ? flat : []);
  }, [toc, status.state]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Black around the book, the page on a white sheet with a margin of its own (user, 2026-10-18). */}
      <div style={{ flex: 1, minHeight: 0, position: "relative", background: "#000", padding: 16, boxSizing: "border-box" }}>
        <div className="book-sheet" style={{ position: "relative", height: "100%", maxWidth: 820, margin: "0 auto", background: "#fff",
          padding: "8px 20px", boxSizing: "border-box", visibility: status.state === "ready" ? "visible" : "hidden" }}>
          <div ref={hostRef} style={{ position: "absolute", inset: "8px 20px" }} />
        </div>
        {status.state === "loading" && <div style={{ position: "absolute", inset: 0 }}><Waiting label="Opening the book…" /></div>}
        {status.state === "drm" && (
          <div style={{ position: "absolute", inset: 0 }}><Message>This book is locked with DRM (it came from the Kindle store), so it cannot be opened here.
            The file is still linked to its row.</Message></div>
        )}
        {status.state === "error" && <div style={{ position: "absolute", inset: 0 }}><Message>The book could not be opened: {status.error}</Message></div>}
      </div>
    </div>
  );
}
const navBtn = { padding: "2px 6px", fontSize: 12, fontFamily: "var(--font-mono)", cursor: "pointer", borderRadius: 4,
  border: "1px solid var(--border-default)", background: "var(--input-bg)", color: "var(--text-primary)",
  display: "inline-flex", alignItems: "center" };

export default function BookReader({ module, occurrence, src, kind, inPanelPage = false, headerExtra = null, dispatch: dispatchProp, socket: socketProp, gridId: gridIdProp }) {
  const ctx = useGridActions() || {};
  const dispatch = dispatchProp || ctx.dispatch;
  const socket = socketProp || ctx.socket;
  const gridId = gridIdProp || ctx.gridId || ctx.state?.gridId;
  const engine = bookEngineFor(kind);
  const title = module?.label || module?.meta?.originalName || "Book";
  const [mode, setMode] = useState("book");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const rootRef = useRef(null);
  const viewRef = useRef(null);
  const pdfCtl = useRef(null);
  // The inner viewers' controls live in this header (one row): the e-book's contents, the PDF's page + zoom.
  const [toc, setToc] = useState([]);
  const [pdfState, setPdfState] = useState({ pageNum: 1, totalPages: 0, zoom: 1.2 });

  // What is on screen: the page's content for Magic / Save page, and the position to remember.
  const [page, setPage] = useState({ content: "", format: "markdown", pos: null });
  const saved = module?.meta?.readingPosition || null;

  // Writing the position: debounced, and only when it moved. Derived (not an undo step — reading is
  // not an edit), and the whole meta goes back because the server replaces `meta` whole.
  const posTimer = useRef(null);
  const lastSaved = useRef(saved);
  const savePosition = useCallback((pos) => {
    if (!module?.id || !pos) return;
    clearTimeout(posTimer.current);
    posTimer.current = setTimeout(() => {
      if (samePosition(pos, lastSaved.current)) return;
      lastSaved.current = pos;
      runDerived(() => CommitHelpers.updateModule({ dispatch, socket, module: { id: module.id, meta: { ...(module.meta || {}), readingPosition: pos } } }));
    }, POSITION_SAVE_MS);
  }, [module?.id, module?.meta, dispatch, socket]);
  useEffect(() => () => clearTimeout(posTimer.current), []);

  const onRelocate = useCallback((detail) => {
    const html = rangeToHtml(detail?.range);
    const pos = makeReadingPosition({ cfi: detail?.cfi, fraction: detail?.fraction });
    setPage({ content: htmlHasText(html) ? html : "", format: "html", pos });
    savePosition(pos);
  }, [savePosition]);

  const pdfReq = useRef(0);
  const onPdfPage = useCallback((pageNum, doc) => {
    const req = ++pdfReq.current;
    const pos = makeReadingPosition({ page: pageNum, fraction: doc?.numPages ? pageNum / doc.numPages : undefined });
    savePosition(pos);
    doc.getPage(pageNum).then((p) => p.getTextContent()).then((tc) => {
      if (pdfReq.current === req) setPage({ content: pdfTextToMarkdown(tc), format: "markdown", pos });
    }).catch(() => { if (pdfReq.current === req) setPage({ content: "", format: "markdown", pos }); });
  }, [savePosition]);

  const isMagic = mode === "magic";
  const label = positionLabel(title, page.pos);
  const { plan, tree } = usePlannedImport({ socket, gridId, content: page.content, format: page.format, shape: "magic", title: label, enabled: isMagic, reqPrefix: "book" });
  const saveAsPage = useSaveAsPage({ socket, gridId, dispatch, rootRef, occurrence });
  const openInPanel = useOpenArtifactInPanel();
  const spreadHost = useSpreadHost();

  const turn = (d) => {
    if (engine === "ebook") { if (d < 0) viewRef.current?.goLeft(); else viewRef.current?.goRight(); }
    else pdfCtl.current?.go(d);
  };
  const flash = (text) => { setNote(text); setTimeout(() => setNote(null), 5000); };
  const savePage = () => {
    if (!page.content || busy) return;
    setBusy(true);
    saveAsPage({ content: page.content, format: page.format, shape: isMagic ? "magic" : "reader", title: label }).then((res) => {
      setBusy(false);
      flash(res.ok ? "Saved this page in Imports" : `Could not save the page: ${res.error}`);
    });
  };
  const openHere = () => {
    if (!occurrence?.id) return;
    const res = openInPanel(occurrence.id, { fromPanelModuleId: spreadHost?.originPanelModuleId || null });
    if (res?.ok && spreadHost) { rememberViewerOrigin(occurrence.id, spreadHost.ownerOccurrenceId); spreadHost.close(); }
  };

  if (!engine) return <Message>This file is not a book this reader can open.</Message>;

  const tabBtn = (m, l) => (
    <button key={m} type="button" onClick={() => setMode(m)} title={TITLES[m]} aria-pressed={mode === m}
      style={{ padding: "2px 8px", fontSize: 12, fontFamily: "var(--font-mono)", cursor: "pointer", borderRadius: 4,
        border: mode === m ? "1px solid var(--accent-blue)" : "1px solid var(--border-default)",
        boxShadow: mode === m ? "inset 0 0 0 1px var(--accent-blue)" : "none",
        fontWeight: mode === m ? 700 : 400,
        background: mode === m ? "var(--accent-blue-bg)" : "var(--input-bg)",
        color: "var(--text-primary)" }}>{l}</button>
  );

  return (
    <div ref={rootRef} data-testid="book-reader" style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
      {/* ONE header row (user, 2026-10-18): modes, page controls, title, actions. In the viewer the
          tile's own handle + buttons sit on this row too (index.css .book-reader-head). */}
      <div className="book-reader-head" style={{ display: "flex", gap: 6, alignItems: "center", padding: "4px 8px", flexShrink: 0, flexWrap: "wrap",
        borderBottom: "1px solid var(--border-subtle)", background: "var(--panel-bg)" }}>
        {MODES.map(([m, l]) => tabBtn(m, l))}
        {/* In Magic these turn the book underneath; the new page is laid out as soon as it lands. */}
        <button type="button" style={navBtn} aria-label="Previous page" title="Previous page" onClick={() => turn(-1)}><ChevronLeft size={14} /></button>
        <button type="button" style={navBtn} aria-label="Next page" title="Next page" onClick={() => turn(1)}><ChevronRight size={14} /></button>
        {engine === "ebook" && toc.length > 0 && (
          <select aria-label="Contents" defaultValue="" style={{ ...navBtn, maxWidth: 200 }}
            onChange={(e) => { if (e.target.value) viewRef.current?.goTo(e.target.value); e.target.value = ""; }}>
            <option value="">Contents…</option>
            {toc.map((t, i) => <option key={i} value={t.href}>{`${"  ".repeat(t.depth)}${t.label}`}</option>)}
          </select>
        )}
        {engine === "pdf" && pdfState.totalPages > 0 && (
          <>
            <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <input type="number" aria-label="Page" min={1} max={pdfState.totalPages} value={pdfState.pageNum}
                onChange={(e) => pdfCtl.current?.jump(e.target.value)}
                style={{ ...navBtn, width: 52, textAlign: "center" }} />
              / {pdfState.totalPages}
            </span>
            <button type="button" style={navBtn} aria-label="Zoom out" title="Zoom out" onClick={() => pdfCtl.current?.zoomBy(-0.2)}>−</button>
            <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-muted)", minWidth: 36, textAlign: "center" }}>{Math.round(pdfState.zoom * 100)}%</span>
            <button type="button" style={navBtn} aria-label="Zoom in" title="Zoom in" onClick={() => pdfCtl.current?.zoomBy(0.2)}>+</button>
          </>
        )}
        <span style={{ flex: 1, minWidth: 8, fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <button type="button" onClick={savePage} disabled={!page.content || busy} aria-label="Save page"
          title="Keep this page: it is added to Imports as a page and opened"
          style={{ ...navBtn, opacity: page.content ? 1 : 0.5 }}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : "Save page"}
        </button>
        {!inPanelPage && !spreadHost && occurrence?.id && (
          <button type="button" onClick={openHere} aria-label="Open in panel" title="Open the book as its own page in a panel"
            style={navBtn}>Open in panel</button>
        )}
        {/* The surface around the reader (a file page, the full-screen card) puts its own buttons
            here, so a book has one header row wherever it opens (user, 2026-10-18). */}
        {headerExtra}
      </div>
      {note && (
        <div style={{ padding: "3px 8px", flexShrink: 0, fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--accent-blue)",
          background: "var(--accent-blue-bg)", borderBottom: "1px solid var(--border-subtle)" }}>{note}</div>
      )}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {/* The book stays mounted under Magic, so going back is instant and keeps the place. */}
        <div style={{ position: "absolute", inset: 0, visibility: isMagic ? "hidden" : "visible" }}>
          {engine === "ebook"
            ? <EbookView src={src} title={title} startCfi={saved?.cfi || null} onRelocate={onRelocate} viewRef={viewRef} onToc={setToc} />
            : <PdfViewer src={src} title={title} initialPage={saved?.page || 1} onPage={onPdfPage} controlRef={pdfCtl} onState={setPdfState} />}
        </div>
        {isMagic && (
          <div style={{ position: "absolute", inset: 0, overflowY: "auto", background: "var(--panel-bg)", color: "var(--text-primary)" }}>
            {!page.content ? (
              <Message>There is no text on this page to lay out.</Message>
            ) : tree ? (
              <React.Suspense fallback={<Waiting label="Laying out the page…" />}>
                <PagePreviewBody parentState={tree.state} occurrenceId={tree.rootOccurrenceId} scroll rootChrome publishComputed={false} />
              </React.Suspense>
            ) : plan?.ok === false ? (
              <Message>The page could not be laid out: {plan.error}</Message>
            ) : (
              <Waiting label="Laying out the page…" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
