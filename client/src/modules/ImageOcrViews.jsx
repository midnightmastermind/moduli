// modules/ImageOcrViews.jsx
//
// An image's viewer gets the browser's tabbed views (user, 2026-10-12: "works like the tabs in browser where
// it switches to ocr view of an image … call it ocr reader and ocr magic"):
//   Image       the picture (whatever the caller renders as children)
//   OCR Reader  the words read off it as ONE textblock
//   OCR Magic   a doc of nested containers and textblocks, the way the Wikipedia import lays out a page
//
// The text views are the browser's Reader/Magic machinery, unchanged: the OCR result becomes markdown
// (helpers/ocrLayout), `import_plan` plans it in the chosen shape WITHOUT writing anything, and
// `PagePreviewBody` renders the plan as real occurrences in an isolated, read-only state
// (helpers/readerPlan). "+ Page" keeps it (import_text in the same shape, filed in Imports, opened);
// "Attach" (Reader) adds the text under the image as an editable textblock, which is what the old OCR
// button did. OCR runs once per image per session — switching tabs reuses it.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useGridActions } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { runOcrPage } from "../helpers/ocr";
import { ocrToMarkdown } from "../helpers/ocrLayout";
import { usePlannedImport, useSaveAsPage } from "../hooks/usePlannedImport";
import { Spinner } from "@/components/ui/spinner";

const PagePreviewBody = React.lazy(() =>
  import("../PagePreviewApp.jsx").then((m) => ({ default: m.PagePreviewBody })),
);

export const OCR_MODES = [["image", "Image"], ["reader", "OCR Reader"], ["magic", "OCR Magic"]];
const TITLES = {
  image: "The picture",
  reader: "The words read off the picture, as one textblock",
  magic: "The words laid out as sections, textblocks and lists — like an imported page",
};

// One OCR per image per session: a promise, so two tabs asking at once share the run.
const ocrCache = new Map();
export function __resetOcrCache() { ocrCache.clear(); }

function useOcr(src, wanted) {
  const [st, setSt] = useState({ status: "idle" });
  useEffect(() => {
    if (!wanted || !src) return undefined;
    let live = true;
    let p = ocrCache.get(src);
    if (!p) {
      p = runOcrPage(src, (m) => {
        if (live && m?.status === "recognizing text" && typeof m.progress === "number") setSt({ status: "loading", progress: m.progress });
      });
      ocrCache.set(src, p);
      p.catch(() => ocrCache.delete(src));
    }
    setSt((s) => (s.status === "done" ? s : { status: "loading", progress: 0 }));
    p.then((page) => { if (live) setSt({ status: "done", page }); })
      .catch((e) => { if (live) setSt({ status: "error", error: e?.message || String(e) }); });
    return () => { live = false; };
  }, [src, wanted]);
  return st;
}

const Waiting = ({ label }) => (
  <div style={{ height: "100%", minHeight: 200, display: "flex", flexDirection: "column", gap: 10, alignItems: "center",
    justifyContent: "center", color: "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
    <Spinner size="md" className="staged-hold-spinner" />
    <span>{label}</span>
  </div>
);

export default function ImageOcrViews({ occurrence, module, imgSrc, children, dispatch, socket, gridId: gridIdProp, userId: userIdProp }) {
  const ctx = useGridActions() || {};
  const { state } = ctx;
  const gridId = gridIdProp || ctx.gridId || state?.gridId;
  const userId = userIdProp || ctx.userId || state?.userId;
  const [mode, setMode] = useState("image");
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(null);
  const rootRef = useRef(null);
  const isText = mode === "reader" || mode === "magic";
  const ocr = useOcr(imgSrc, isText);
  const title = module?.label || "Image";

  const markdown = useMemo(
    () => (ocr.status === "done" && isText ? ocrToMarkdown(ocr.page, { mode }) : ""),
    [ocr, isText, mode],
  );

  // Planned per shape + text (cached), and "+ Page" — both shared with the book reader.
  const { plan, tree } = usePlannedImport({ socket, gridId, content: markdown, format: "markdown", shape: mode, title, enabled: isText, reqPrefix: "ocr" });
  const saveAsPage = useSaveAsPage({ socket, gridId, userId, dispatch, rootRef, occurrence });

  const flash = (text) => { setNote(text); setTimeout(() => setNote(null), 5000); };

  const addAsPage = useCallback(() => {
    if (!markdown || busy) return;
    setBusy("page");
    saveAsPage({ content: markdown, format: "markdown", shape: mode, title }).then((res) => {
      setBusy(null);
      flash(res.ok ? "Added as a page in Imports" : `Could not add the page: ${res.error}`);
    });
  }, [markdown, busy, saveAsPage, mode, title]);

  // The old OCR button's outcome: the text as an editable textblock under the image.
  const attach = useCallback(() => {
    if (!markdown || !occurrence || !gridId || !userId) return;
    const paragraphs = markdown.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const textmap = { type: "doc", content: paragraphs.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t.replace(/^\\/, "") }] })) };
    const moduleId = crypto.randomUUID(); const occId = crypto.randomUUID();
    CommitHelpers.createModule({ dispatch, socket, module: { id: moduleId, userId, gridId, role: "textblock", kind: "doc", label: "OCR" } });
    CommitHelpers.createOccurrence({ dispatch, socket, occurrence: { id: occId, userId, gridId, moduleId, parentId: occurrence.id, textmap } });
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: occurrence.id, occurrences: [...(occurrence.occurrences || []), occId] } });
    setMode("image");
    flash("The text is under the picture");
  }, [markdown, occurrence, gridId, userId, dispatch, socket]);

  const tabBtn = (m, label) => (
    <button key={m} type="button" onClick={() => setMode(m)} title={TITLES[m]} aria-pressed={mode === m}
      style={{ padding: "2px 8px", fontSize: 12, fontFamily: "var(--font-mono)", cursor: "pointer", borderRadius: 4,
        // The active tab is an outline, like the book reader's (a filled accent read green on green in Terminal).
        border: mode === m ? "1px solid var(--accent-blue)" : "1px solid var(--border-default)",
        boxShadow: mode === m ? "inset 0 0 0 1px var(--accent-blue)" : "none",
        fontWeight: mode === m ? 700 : 400,
        background: mode === m ? "var(--accent-blue-bg)" : "var(--input-bg)",
        color: "var(--text-primary)" }}>{label}</button>
  );
  const actBtn = { padding: "2px 8px", fontSize: 12, fontFamily: "var(--font-mono)", cursor: "pointer", borderRadius: 4,
    border: "1px solid var(--border-default)", background: "var(--input-bg)", color: "var(--text-primary)" };

  return (
    <div ref={rootRef} data-testid="image-ocr-views" style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
      {/* In the viewer the tile's handle + buttons sit on this row too (index.css .ocr-views-head). */}
      <div className="ocr-views-head" style={{ display: "flex", gap: 6, alignItems: "center", padding: "4px 8px", flexShrink: 0, flexWrap: "wrap",
        borderBottom: "1px solid var(--border-subtle)", background: "var(--panel-bg)" }}>
        {OCR_MODES.map(([m, l]) => tabBtn(m, l))}
        <span style={{ flex: 1 }} />
        {isText && markdown && (
          <>
            {mode === "reader" && <button type="button" style={actBtn} onClick={attach} title="Add the text under the picture as an editable textblock">Attach</button>}
            <button type="button" style={actBtn} onClick={addAsPage} disabled={busy === "page"} aria-label="Add as page"
              title={`Add this ${mode === "reader" ? "OCR Reader" : "OCR Magic"} view to the grid as a page`}>
              {busy === "page" ? <Loader2 size={12} className="animate-spin" /> : "+ Page"}
            </button>
          </>
        )}
      </div>
      {note && (
        <div style={{ padding: "3px 8px", flexShrink: 0, fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--accent-blue)",
          background: "var(--accent-blue-bg)", borderBottom: "1px solid var(--border-subtle)" }}>{note}</div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflow: mode === "image" ? "auto" : "hidden" }}>
        {mode === "image" ? children : (
          <div style={{ height: "100%", overflowY: "auto", background: "var(--panel-bg)", color: "var(--text-primary)" }}>
            {ocr.status === "error" ? (
              <div style={{ padding: 16, fontSize: 12, color: "var(--text-muted)" }}>Could not read the picture: {ocr.error}</div>
            ) : ocr.status !== "done" ? (
              <Waiting label={`Reading the picture… ${Math.round((ocr.progress || 0) * 100)}%`} />
            ) : !markdown ? (
              <div style={{ padding: 16, fontSize: 12, color: "var(--text-muted)" }}>No text found in this picture.</div>
            ) : tree ? (
              <React.Suspense fallback={<Waiting label="Laying out the text…" />}>
                <PagePreviewBody parentState={tree.state} occurrenceId={tree.rootOccurrenceId} scroll rootChrome publishComputed={false} />
              </React.Suspense>
            ) : plan?.ok === false ? (
              <div style={{ padding: 16, fontSize: 12, color: "var(--text-muted)" }}>The text could not be laid out: {plan.error}</div>
            ) : (
              <Waiting label="Laying out the text…" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
