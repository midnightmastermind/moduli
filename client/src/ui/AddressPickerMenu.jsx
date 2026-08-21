// ui/AddressPickerMenu.jsx
// ============================================================
// The `address` field type's editor — a map search over /api/addresses/search,
// plus a hand-entry tab.
//
// HAND ENTRY IS NOT A FALLBACK, IT IS A FIRST-CLASS TAB, and that came from
// measuring rather than from caution. Probing the real geocoders for the user's
// own places:
//
//   "Froedtert"                       photon OK    nominatim OK
//   "2010 W Wisconsin Ave Milwaukee"  photon MISS  nominatim OK
//   "Dewey Center Milwaukee"          photon MISS  nominatim MISS
//
// The Dewey Center is not in OpenStreetMap under that name. A search box that
// cannot express "I know where this is, the database doesn't" would make that
// place unenterable.
//
// Mounted ONCE as <AddressPickerHost/> in App and opened imperatively — the
// same reason ImagePickerMenu is: call sites live inside popovers and dropdowns
// that unmount on outside clicks, so a locally-rendered modal would vanish with
// its host.
// ============================================================
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, MapPin, X, Loader2, Pencil } from "lucide-react";
import { buildLocationMeta, formatLatLon } from "../helpers/geocode";

// ── Imperative controller ────────────────────────────────────────────────
let _hostListener = null;
export function registerAddressPickerHost(fn) {
  _hostListener = fn;
  return () => { if (_hostListener === fn) _hostListener = null; };
}
export function openAddressPicker(request) {
  if (!_hostListener) {
    console.warn("[AddressPicker] no host mounted — is <AddressPickerHost/> in App?");
    return;
  }
  _hostListener(request);
}

export function AddressPickerHost() {
  const [req, setReq] = useState(null);
  useEffect(() => registerAddressPickerHost((r) => setReq(r || null)), []);
  return (
    <AddressPickerMenu
      open={!!req}
      onClose={() => setReq(null)}
      onPick={(v) => { req?.onPick?.(v); }}
      initialQuery={req?.query || ""}
      initialValue={req?.value || null}
      title={req?.title || "Set address"}
    />
  );
}

const TABS = [
  { id: "search", label: "Search", Icon: Search },
  { id: "manual", label: "Enter by hand", Icon: Pencil },
];

export default function AddressPickerMenu({
  open,
  onClose,
  onPick,            // (location|null) => void
  initialQuery = "",
  initialValue = null,
  title = "Set address",
}) {
  const [tab, setTab] = useState("search");
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState(null); // null = not searched yet
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [source, setSource] = useState(null);
  // Hand-entry drafts
  const [draftLabel, setDraftLabel] = useState("");
  const [draftAddress, setDraftAddress] = useState("");
  const searchedOnceRef = useRef(false);
  const inputRef = useRef(null);

  // Fresh open → reset to this subject and auto-search it (the Calibre
  // behaviour ImagePickerMenu established: opening the dialog looks it up).
  useEffect(() => {
    if (!open) return;
    setTab("search");
    setQuery(initialQuery);
    setResults(null);
    setError(null);
    setSource(null);
    setDraftLabel(initialValue?.label || initialQuery || "");
    setDraftAddress(initialValue?.address || "");
    searchedOnceRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && initialQuery && !searchedOnceRef.current) {
      searchedOnceRef.current = true;
      runSearch(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialQuery]);

  async function runSearch(q) {
    const term = String(q || "").trim();
    if (!term) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/addresses/search?q=${encodeURIComponent(term)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message || j?.error || `search failed (${r.status})`);
      setResults(j.results || []);
      setSource(j.source || null);
    } catch (e) {
      setError(e.message);
      setResults([]);
    } finally {
      setBusy(false);
    }
  }

  function commit(loc) {
    onPick?.(loc);
    onClose?.();
  }

  function commitManual() {
    const address = draftAddress.trim();
    const label = draftLabel.trim();
    if (!address && !label) return;
    // No coordinates: hand entry means the geocoder could not find it, so
    // there is nothing honest to store. buildLocationMeta would reject that,
    // and rightly — it is for located places. A hand-entered address is the
    // text alone.
    commit({ label: label || address, address, lat: null, lon: null, osmId: null });
  }

  if (!open) return null;

  // Same modal shell as ImagePickerMenu — this is the other half of the same
  // affordance (a searchable picker opened from a field), so it should not look
  // like a different kind of surface.
  const surface = {
    background: "var(--surface-overlay, #16202b)",
    border: "1px solid hsl(var(--border, 0 0% 25%))",
    borderRadius: 10,
    color: "var(--text-primary, #e5edf5)",
    boxShadow: "var(--menu-shadow-3)",
  };

  return createPortal(
    <div
      data-address-picker
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose?.(); }}
      onContextMenu={(e) => e.stopPropagation()}
      style={{
        position: "fixed", inset: 0, zIndex: 12000,
        background: "var(--scrim)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div style={{ ...surface, width: 480, maxWidth: "94vw", maxHeight: "82vh", display: "flex", flexDirection: "column" }}>
        {/* header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 14px", borderBottom: "1px solid hsl(var(--border, 0 0% 25%))",
        }}>
          <MapPin style={{ width: 15, height: 15, opacity: 0.7 }} />
          <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{title}</span>
          <button type="button" onClick={onClose} title="Close"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
            <X style={{ width: 15, height: 15 }} />
          </button>
        </div>

        {/* tabs */}
        <div style={{ display: "flex", gap: 2, padding: "6px 8px 0" }}>
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} type="button" onClick={() => setTab(id)}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 10px", fontSize: 11, borderRadius: "5px 5px 0 0",
                border: "none", cursor: "pointer",
                background: tab === id ? "var(--input-bg)" : "transparent",
                color: tab === id ? "var(--text-primary)" : "var(--text-muted)",
                fontWeight: tab === id ? 600 : 400,
              }}>
              <Icon style={{ width: 12, height: 12 }} />{label}
            </button>
          ))}
        </div>

        {tab === "search" && (
          <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
            <form onSubmit={(e) => { e.preventDefault(); runSearch(query); }}
              style={{ display: "flex", gap: 6 }}>
              <input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="A place or a street address…"
                style={{
                  flex: 1, padding: "6px 9px", fontSize: 12,
                  background: "var(--input-bg)", color: "var(--text-primary)",
                  border: "1px solid var(--input-border)", borderRadius: 5,
                }}
              />
              <button type="submit" disabled={busy || !query.trim()}
                style={{
                  padding: "6px 12px", fontSize: 12, borderRadius: 5, cursor: "pointer",
                  border: "1px solid var(--accent-blue-border)",
                  background: "var(--accent-blue-bg)", color: "var(--accent-blue-text)",
                  opacity: busy || !query.trim() ? 0.5 : 1,
                }}>
                {busy ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> : "Search"}
              </button>
            </form>

            {error && (
              <div style={{ fontSize: 11, color: "var(--danger-text)" }}>{error}</div>
            )}

            <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
              {results?.map((r, i) => (
                <button key={r.osmId || i} type="button" onClick={() => commit(buildLocationMeta(r) || r)}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1,
                    padding: "7px 9px", textAlign: "left", cursor: "pointer",
                    background: "var(--input-bg)", border: "1px solid var(--border-subtle)",
                    borderRadius: 5, color: "var(--text-primary)",
                  }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{r.label}</span>
                  {r.address && (
                    <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{r.address}</span>
                  )}
                  <span style={{ fontSize: 9.5, color: "var(--text-faint)" }}>
                    {r.kind ? `${r.kind} · ` : ""}{formatLatLon(r.lat, r.lon, 4)}
                  </span>
                </button>
              ))}

              {results && results.length === 0 && !busy && (
                // Not an error — plenty of real places simply are not in
                // OpenStreetMap. Point at the tab that can still record it.
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", padding: "10px 4px", lineHeight: 1.5 }}>
                  No matches for “{query}”. Not every place is in the map database —
                  <button type="button" onClick={() => setTab("manual")}
                    style={{
                      background: "none", border: "none", padding: "0 3px", cursor: "pointer",
                      color: "var(--accent-blue-text)", textDecoration: "underline", fontSize: 11.5,
                    }}>enter it by hand</button>
                  instead.
                </div>
              )}
            </div>

            {source && results?.length > 0 && (
              <div style={{ fontSize: 9.5, color: "var(--text-faint)", textAlign: "right" }}>
                via {source} · © OpenStreetMap contributors
              </div>
            )}
          </div>
        )}

        {tab === "manual" && (
          <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>Name</span>
              <input value={draftLabel} onChange={(e) => setDraftLabel(e.target.value)}
                placeholder="Dewey Center"
                style={{
                  padding: "6px 9px", fontSize: 12, background: "var(--input-bg)",
                  color: "var(--text-primary)", border: "1px solid var(--input-border)", borderRadius: 5,
                }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>Address</span>
              <textarea value={draftAddress} onChange={(e) => setDraftAddress(e.target.value)}
                rows={3} placeholder="2010 W Wisconsin Ave, Milwaukee, WI 53233"
                style={{
                  padding: "6px 9px", fontSize: 12, background: "var(--input-bg)", resize: "vertical",
                  color: "var(--text-primary)", border: "1px solid var(--input-border)", borderRadius: 5,
                }} />
            </label>
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => commit(null)}
                style={{
                  padding: "6px 12px", fontSize: 12, borderRadius: 5, cursor: "pointer",
                  border: "1px solid var(--border-default)", background: "transparent",
                  color: "var(--text-muted)",
                }}>Clear</button>
              <button type="button" onClick={commitManual}
                disabled={!draftAddress.trim() && !draftLabel.trim()}
                style={{
                  padding: "6px 12px", fontSize: 12, borderRadius: 5, cursor: "pointer",
                  border: "1px solid var(--accent-blue-border)",
                  background: "var(--accent-blue-bg)", color: "var(--accent-blue-text)",
                  opacity: (!draftAddress.trim() && !draftLabel.trim()) ? 0.5 : 1,
                }}>Save</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
