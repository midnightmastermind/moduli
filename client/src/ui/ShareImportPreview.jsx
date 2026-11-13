// ui/ShareImportPreview.jsx — what Auto will create, shown before Clip is pressed (smarter imports Task 5).
//
// Read-only. `preview` is GET /share/stage/:id/import-preview — the server's import pipeline run in dry-run
// mode over the staged clip, so these lines are what will be written. Ollama clean-up runs after saving and
// is named, never previewed.
import React from "react";

const MSG = {
  loading: "Reading the page…",
  partial: "Still reading the page — it will be built after saving.",
  noLinkPage: "The readable page could not be built. The bookmark is still saved.",
  noPage: "Nothing to read here — it is saved as it is.",
};

export default function ShareImportPreview({ preview, loading, photo = null }) {
  return (
    <section data-testid="share-import-preview" style={boxSt}>
      <div style={headSt}>Will be created in Imports</div>
      {/* A shared PHOTO is shown here at a size you can see (user, 2026-11-13) — the page made
          from it keeps the picture, so the preview of that page should too. */}
      {photo && <img data-testid="preview-photo" src={photo} alt="" style={photoSt} />}
      {loading && !preview ? <div style={mutedSt}>{MSG.loading}</div> : preview ? (
        <>
          <div style={{ fontWeight: 600, fontSize: 12, wordBreak: "break-word" }}>{preview.label}</div>
          {preview.board && (
            <div data-testid="preview-board" style={mutedSt}>Shaped like a row of “{preview.board.label}” — you file it from Imports.</div>
          )}
          {preview.partial ? <div style={mutedSt}>{MSG.partial}</div>
            : !preview.willBuildPage ? <div style={mutedSt}>{preview.kind === "link" ? MSG.noLinkPage : MSG.noPage}</div>
            : (
              <>
                {preview.kind === "link" && <div style={mutedSt}>A bookmark, and the page laid out to read:</div>}
                <div data-testid="preview-body" style={bodySt}>
                  {(preview.bodyLines || []).map((l, i) => <div key={i} style={lineSt}>{l}</div>)}
                </div>
                {preview.images?.length > 0 && (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                    {preview.images.slice(0, 6).map((u) => (
                      <img key={u} src={u} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 3 }} />
                    ))}
                  </div>
                )}
              </>
            )}
          {preview.aiNote && <div style={{ ...mutedSt, marginTop: 6, fontStyle: "italic" }}>{preview.aiNote}</div>}
        </>
      ) : null}
    </section>
  );
}

const boxSt = { margin: "4px 0 8px 22px", padding: "6px 8px", border: "1px solid var(--border-default, #333)", borderRadius: 4, minWidth: 0, overflow: "hidden" };
const photoSt = { display: "block", width: "100%", maxHeight: 220, objectFit: "contain", borderRadius: 3, marginBottom: 6, background: "rgba(0,0,0,0.25)" };
const headSt = { fontSize: 11, color: "var(--text-faint, #888)", marginBottom: 4 };
const mutedSt = { fontSize: 11, color: "var(--text-muted, #aaa)" };
const bodySt = { maxHeight: 120, overflowY: "auto", marginTop: 2 };
const lineSt = { fontSize: 11, lineHeight: 1.45, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
