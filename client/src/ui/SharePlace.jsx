// ui/SharePlace.jsx — THE SHARE PLACEMENT WINDOW.
//
// Opened by the companion extension's "Clip … (choose…)" menu item, and by
// SharePending for a phone or Windows share, at
// `/share-place?stage=<id>&k=<key>` (spec docs/superpowers/specs/
// 2026-09-28-share-placement-window-design.md).
//
// Three modes, one row of radios:
//   Auto    the grid's share rules decide — and the window NAMES the rule and
//           where it files things before you commit (the whole feature exists
//           because a clip went somewhere the user could not find)
//   New     you pick a destination; the new row is shaped like the rows
//           already there, and you map what the clip carries onto its fields
//   Preset  a saved New, still editable after picking
//
// NOTHING IS WRITTEN UNTIL "Clip" IS PRESSED. Closing the window leaves the
// stage to expire unused.
//
// Every decision lives in helpers/sharePlacement + sharePresets + shareMapping;
// this file owns fetches and form state.
//
// AUTH: the stage key authorizes reading and committing THIS clip, and nothing
// else — so a signed-out browser gets Auto only. Grids, fields, destinations
// and presets are read with the app's own session token (the same Bearer
// SharePending sends), which those routes accept.
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

// LAZY: FieldSelect lives in the app's shared chunk (~1.1 MB), and this page
// is often opened cold — from the extension or a phone share — just to press
// Auto. It loads only when "+ field…" is clicked.
const FieldSelect = lazy(() => import("./FieldSelect.jsx"));
const ImagePickerMenu = lazy(() => import("./ImagePickerMenu.jsx"));
import { AUTH_KEYS } from "../helpers/authStorage";
import { SHARE_SOURCES, SHARE_TRANSFORMS, resolveMapping } from "../helpers/shareMapping.js";
import {
  CLIP_KINDS, clipFromStage, shapeFromDestination, shapeFromKind, autoMappings, isShapeRow, buildSharePayload,
} from "../helpers/sharePlacement.js";
import { coverSearchQuery } from "../helpers/coverQuery.js";
import { readPresets, withPreset, replacePreset, deletePreset, presetFromForm, formFromPreset } from "../helpers/sharePresets.js";

const readLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const param = (k) => new URLSearchParams(window.location.search).get(k) || "";
const enc = encodeURIComponent;

// The label a new row gets unless you change it: the page title with its site
// suffix stripped ("… (2006) IMDb" → "… (2006)").
const DEFAULT_LABEL = { source: "title", transform: "stripSuffix" };

export default function SharePlace() {
  const stageId = useMemo(() => param("stage"), []);
  const stageKey = useMemo(() => param("k"), []);
  const token = useMemo(() => readLocal(AUTH_KEYS.token), []);

  const api = useCallback((path, opts = {}) => fetch(`/api/v1${path}`, {
    ...opts,
    headers: { ...(opts.headers || {}), ...(token ? { authorization: `Bearer ${token}` } : null) },
  }), [token]);
  const getJson = useCallback(async (path) => {
    const r = await api(path).catch(() => null);
    return r?.ok ? r.json().catch(() => ({})) : null;
  }, [api]);

  const [payload, setPayload] = useState(null);
  const [gone, setGone] = useState(false);
  const [grids, setGrids] = useState([]);
  const [gridId, setGridId] = useState("");
  const [mode, setMode] = useState("auto");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);

  // New / Preset form
  const [fields, setFields] = useState([]);
  const [presets, setPresets] = useState([]);
  // Presets the GRID implies — one per board it already files things into.
  // Computed server-side per request and stored nowhere, so they follow the
  // grid; picking one fills the form exactly as a saved preset does, and
  // "Save as preset…" is what makes a chosen one permanent.
  const [suggested, setSuggested] = useState([]);
  const [presetId, setPresetId] = useState("");
  const [q, setQ] = useState("");
  const [dests, setDests] = useState([]);
  const [destination, setDestination] = useState(null);
  const [siblingShape, setSiblingShape] = useState(null);
  const [kindOverride, setKindOverride] = useState("");
  const [mappings, setMappings] = useState({});
  const [labelMapping, setLabelMapping] = useState(DEFAULT_LABEL);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState(null);
  // The row's picture. `coverTouched` = the user picked or cleared it, so the
  // page's own suggestion (fetched below) never overwrites their choice.
  const [cover, setCover] = useState("");
  const [coverTouched, setCoverTouched] = useState(false);
  const [pickingCover, setPickingCover] = useState(false);
  // Every picture the clipped page offers, so the picker opens on the share's
  // own photos rather than a web search for its title.
  const [coverChoices, setCoverChoices] = useState([]);

  const clip = useMemo(() => (payload ? clipFromStage(payload) : null), [payload]);
  const shape = useMemo(
    () => (kindOverride ? shapeFromKind(kindOverride) : siblingShape) || shapeFromDestination(null),
    [kindOverride, siblingShape]);

  // ── the staged clip, then where shares go by default ────────────────────
  useEffect(() => {
    let live = true;
    (async () => {
      const r = await fetch(`/api/v1/share/stage/${enc(stageId)}?k=${enc(stageKey)}`).catch(() => null);
      if (!live) return;
      if (!r?.ok) { setGone(true); return; }
      const p = (await r.json().catch(() => ({}))).payload || {};
      setPayload(p);
      if (!token) return;       // signed out: the preview resolves the grid itself
      const [me, gs] = await Promise.all([getJson("/me/share"), getJson("/grids")]);
      if (!live) return;
      const list = gs?.grids || [];
      setGrids(list);
      const lastGrid = readLocal(AUTH_KEYS.gridId);
      const pick = [p.gridId, me?.gridId, lastGrid, list[0]?.id].find((id) => id && list.some((g) => g.id === id));
      setGridId(pick || "");
    })();
    return () => { live = false; };
  }, [stageId, stageKey, token, getJson]);

  // ── which rule Auto would run — re-asked whenever the grid changes ──────
  useEffect(() => {
    if (!payload || (token && !gridId)) return;
    let live = true;
    const g = gridId ? `&gridId=${enc(gridId)}` : "";
    fetch(`/api/v1/share/stage/${enc(stageId)}/preview?k=${enc(stageKey)}${g}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (live) setPreview(b); })
      .catch(() => { if (live) setPreview(null); });
    return () => { live = false; };
  }, [payload, gridId, stageId, stageKey, token]);

  // ── the grid's fields and presets; a grid change resets the form ────────
  useEffect(() => {
    setDestination(null); setSiblingShape(null); setKindOverride(""); setMappings({});
    setLabelMapping(DEFAULT_LABEL); setPresetId(""); setQ(""); setDests([]);
    if (!token || !gridId) { setFields([]); setPresets([]); setSuggested([]); return; }
    let live = true;
    getJson(`/fields?gridId=${enc(gridId)}&limit=500`).then((b) => { if (live) setFields(b?.fields || []); });
    getJson(`/share/presets?gridId=${enc(gridId)}`).then((b) => {
      if (!live) return;
      setPresets(b?.presets || []);
      setSuggested(b?.suggested || []);
    });
    return () => { live = false; };
  }, [gridId, token, getJson]);

  // ── destination search, as you type ─────────────────────────────────────
  const searchSeq = useRef(0);
  useEffect(() => {
    if (!token || !gridId || destination || mode === "auto") return;
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      const b = await getJson(`/destinations?gridId=${enc(gridId)}&q=${enc(q)}&limit=30`);
      if (seq === searchSeq.current) setDests(b?.destinations || []);
    }, 200);
    return () => clearTimeout(t);
  }, [q, gridId, token, destination, mode, getJson]);

  const pickDestination = (d) => {
    const s = shapeFromDestination(d);
    setDestination(d);
    setSiblingShape(s);
    setKindOverride("");
    // The rows the shape implies arrive pre-filled and marked (auto); rows
    // the user already mapped stay.
    setMappings((prev) => ({ ...Object.fromEntries(Object.entries(prev).filter(([, m]) => !isShapeRow(m))), ...autoMappings(s) }));
  };

  const changeKind = (value) => {
    setKindOverride(value);
    // An override is NOT like its neighbours, so their implied values go.
    setMappings((prev) => (value
      ? Object.fromEntries(Object.entries(prev).filter(([, m]) => !isShapeRow(m)))
      : { ...prev, ...autoMappings(siblingShape) }));
  };

  const pickPreset = (id) => {
    setPresetId(id);
    const p = presets.find((x) => x.id === id) || suggested.find((x) => x.id === id);
    if (!p) return;
    const f = formFromPreset(p);
    setDestination(f.destination);
    setSiblingShape(f.shape);
    setKindOverride("");
    setMappings(f.mappings);
    setLabelMapping(f.labelMapping || DEFAULT_LABEL);
  };

  // The saved preset currently selected, if any. A SUGGESTED one is not saved —
  // it is recomputed per request and has no row to overwrite — so "Update" and
  // "Delete" are offered only for the real thing.
  const savedPreset = presets.find((p) => p.id === presetId) || null;

  const writePresets = async (next, msg) => {
    const r = await api("/share/presets", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ gridId, presets: next }),
    }).catch(() => null);
    if (!r?.ok) { setNotice("Could not save the preset."); return null; }
    const saved = (await r.json().catch(() => ({}))).presets || next;
    setPresets(saved);
    if (msg) setNotice(msg);
    return saved;
  };

  const savePreset = async () => {
    const chosen = savedPreset || suggested.find((p) => p.id === presetId);
    const name = window.prompt("Save this placement as a preset named:", chosen?.name || destination?.label || "");
    if (!name || !name.trim()) return;
    const next = withPreset(readPresets({ meta: { sharePresets: presets } }),
      presetFromForm({ name, destination, shape, mappings, labelMapping }));
    const saved = await writePresets(next, `Saved preset “${name.trim()}”.`);
    if (!saved) return;
    setPresetId(saved.find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase())?.id || "");
  };

  // OVERWRITE THE ONE YOU ARE LOOKING AT. `withPreset` matches on the NAME, so
  // the only way to change a preset was to retype its name exactly — and the
  // control sat below a fold that could not scroll.
  const updatePreset = async () => {
    if (!savedPreset) return;
    const next = replacePreset(presets, savedPreset.id,
      presetFromForm({ name: savedPreset.name, destination, shape, mappings, labelMapping }));
    const saved = await writePresets(next, `Updated “${savedPreset.name}”.`);
    if (saved) setPresetId(savedPreset.id);   // replacePreset keeps the id
  };

  const removePreset = async () => {
    if (!savedPreset) return;
    if (!window.confirm(`Delete the preset “${savedPreset.name}”?`)) return;
    const saved = await writePresets(deletePreset(presets, savedPreset.id), `Deleted “${savedPreset.name}”.`);
    if (saved) setPresetId("");   // the form keeps what it is showing; only the selection goes
  };

  const manual = mode !== "auto";
  // A media row (movie, book, bookmark) draws its picture from its cover; an
  // image clip's picture is the file itself, so it gets no cover row.
  const wantsCover = manual && !!destination && shape.role === "artifact" && shape.fileFrom !== "imageUrl";

  // Suggest the page's own og:image once, the first time a cover would apply.
  useEffect(() => {
    if (!wantsCover || coverTouched || (cover && coverChoices.length) || !stageId) return;
    let live = true;
    fetch(`/api/v1/share/stage/${enc(stageId)}/cover?k=${enc(stageKey)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!live || !b) return;
        if (b.cover) setCover(b.cover);
        if (Array.isArray(b.candidates)) setCoverChoices(b.candidates);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [wantsCover, coverTouched, cover, coverChoices.length, stageId, stageKey]);

  const canClip = !busy && !!payload && (manual ? !!destination && !!token && !!gridId : true);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const body = buildSharePayload({
        gridId, mode: manual ? "manual" : "auto", stageId, stageKey,
        destination, shape, mappings, labelMapping, clip, cover: wantsCover ? cover : "",
      });
      const r = await fetch("/api/v1/share", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 401) { setGone(true); return; }
        setError(b.message || b.error || `HTTP ${r.status}`);
        return;
      }
      setDone(b);
      setTimeout(() => { try { window.close(); } catch { /* a navigated tab cannot close itself */ } }, 1200);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  if (gone) return <Shell><p>That clip has expired or was already placed. Clip it again if it isn’t in Moduli.</p></Shell>;
  if (!payload) return <Shell><p>Loading…</p></Shell>;
  if (done) {
    const where = manual ? destination?.label : (preview?.lands || preview?.ruleName);
    return (
      <Shell>
        <p><strong>Clipped.</strong>{where ? ` Filed in ${where}.` : ""}</p>
        <p style={{ fontSize: 12 }}><a href="/" style={{ color: "var(--link, #8ab4ff)" }}>Open Moduli</a></p>
      </Shell>
    );
  }

  const mappedIds = new Set(Object.keys(mappings));
  const fieldsById = Object.fromEntries(fields.map((f) => [f.id, f]));
  const likeRows = siblingShape?.bindingsLike ? destination?.childCount : null;

  return (
    <Shell>
      <header style={{ marginBottom: 12, display: "flex", gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, wordBreak: "break-word" }}>{clip.title || clip.url || clip.selection}</div>
          {clip.url && <div style={{ fontSize: 11, color: "var(--text-faint, #888)", wordBreak: "break-all" }}>{clip.url}</div>}
        </div>
        {clip.imageUrl && <img src={clip.imageUrl} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 4 }} />}
      </header>

      <label htmlFor="share-grid" style={lblSt}>Grid</label>
      {token ? (
        <select id="share-grid" value={gridId} onChange={(e) => setGridId(e.target.value)} style={inputSt}>
          {grids.map((g) => <option key={g.id} value={g.id}>{g.name || "(unnamed grid)"}</option>)}
        </select>
      ) : (
        <div id="share-grid" style={{ ...inputSt, opacity: 0.8 }}>your share grid</div>
      )}

      <fieldset style={{ border: 0, padding: 0, margin: "12px 0 4px" }}>
        <label style={rowSt}>
          <input type="radio" name="mode" aria-label="Auto" checked={mode === "auto"} onChange={() => setMode("auto")} /> Auto
        </label>
        {mode === "auto" && (
          <div data-testid="auto-rule" style={{ fontSize: 11, color: "var(--text-muted, #aaa)", margin: "2px 0 8px 22px" }}>
            {preview?.ruleName
              ? <>→ {preview.ruleName}{preview.lands ? <> · files it in <strong>{preview.lands}</strong></> : null}</>
              : "→ no rule matches — the catch-all will file it"}
          </div>
        )}
        <label style={rowSt}>
          <input type="radio" name="mode" aria-label="New" checked={mode === "new"} onChange={() => setMode("new")} disabled={!token} /> New
        </label>
        <label style={rowSt}>
          <input type="radio" name="mode" aria-label="Preset" checked={mode === "preset"} onChange={() => setMode("preset")} disabled={!token} /> Preset
        </label>
        {!token && (
          <div style={{ fontSize: 11, color: "var(--text-muted, #aaa)", marginLeft: 22 }}>
            <a href="/login" target="_blank" rel="noreferrer" style={{ color: "var(--link, #8ab4ff)" }}>Sign in</a> to place it by hand.
          </div>
        )}
      </fieldset>

      {manual && token && (
        <section style={{ borderTop: "1px solid var(--border-default, #333)", paddingTop: 8 }}>
          {mode === "preset" && (
            <div style={{ marginBottom: 8 }}>
              <label htmlFor="share-preset" style={lblSt}>Preset</label>
              {presets.length || suggested.length ? (
                <select id="share-preset" value={presetId} onChange={(e) => pickPreset(e.target.value)} style={inputSt}>
                  <option value="">— pick a preset —</option>
                  {presets.length > 0 && (
                    <optgroup label="Saved">
                      {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </optgroup>
                  )}
                  {/* The grid's own boards. Grouped and labelled, because one of
                      these is a guess from the shape of a board and a saved one
                      is a decision the user made. */}
                  {suggested.length > 0 && (
                    <optgroup label="From your boards">
                      {suggested.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}{p.kind ? ` — ${p.kind}` : ""}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              ) : (
                <div style={{ fontSize: 11, color: "var(--text-muted, #aaa)" }}>No presets on this grid yet — place one with New, then “Save as preset…”.</div>
              )}
            </div>
          )}

          <label style={lblSt}>Where</label>
          {destination ? (
            <div style={{ ...inputSt, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{destination.label}{destination.crumb ? <span style={{ color: "var(--text-faint, #888)", fontSize: 10 }}> · {destination.crumb}</span> : null}</span>
              <button type="button" onClick={() => { setDestination(null); setSiblingShape(null); setKindOverride(""); setMappings((p) => Object.fromEntries(Object.entries(p).filter(([, m]) => !isShapeRow(m)))); }} style={linkBtnSt}>change</button>
            </div>
          ) : (
            <>
              <input placeholder="search containers and pages" value={q} onChange={(e) => setQ(e.target.value)} style={inputSt} autoFocus />
              <div style={{ maxHeight: 170, overflowY: "auto", marginTop: 2 }}>
                {dests.map((d) => (
                  <button type="button" key={d.id} onClick={() => pickDestination(d)} style={destRowSt}>
                    <span>{d.label}</span>
                    <span style={{ color: "var(--text-faint, #888)", fontSize: 10 }}>
                      {[d.crumb, d.childCount ? `${d.childCount} rows` : null].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {destination && (
            <div style={{ fontSize: 11, color: "var(--text-muted, #aaa)", margin: "6px 0", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span data-testid="shape">
                Shape: {kindOverride
                  ? CLIP_KINDS.find((k) => k.value === kindOverride)?.label
                  : likeRows != null
                    ? `like its ${likeRows} rows — ${shape.role}${shape.kind ? `/${shape.kind}` : ""}`
                    : `${shape.role}${shape.kind ? `/${shape.kind}` : ""}`}
              </span>
              <select aria-label="make it a" value={kindOverride} onChange={(e) => changeKind(e.target.value)} style={{ ...miniSelSt }}>
                <option value="">{siblingShape?.bindingsLike ? "like its rows" : "plain item"}</option>
                {CLIP_KINDS.map((k) => <option key={k.value} value={k.value}>make it a {k.label.toLowerCase()}</option>)}
              </select>
            </div>
          )}

          {wantsCover && (
            <div data-testid="cover-row" style={{ marginTop: 8 }}>
              <label style={lblSt}>Cover</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {cover
                  ? <img src={cover} alt="" style={{ width: 40, height: 56, objectFit: "cover", borderRadius: 3 }} />
                  : <div style={{ width: 40, height: 56, borderRadius: 3, border: "1px dashed var(--border-default, #444)" }} />}
                <button type="button" onClick={() => setPickingCover(true)} style={linkBtnSt}>{cover ? "Change…" : "Pick…"}</button>
                {cover && (
                  <button type="button" onClick={() => { setCover(""); setCoverTouched(true); }} style={linkBtnSt}>Clear</button>
                )}
              </div>
              {pickingCover && (
                <Suspense fallback={null}>
                  <ImagePickerMenu
                    open
                    title={`Cover — ${clip.title || "untitled"}`}
                    initialQuery={coverSearchQuery({ label: clip.title, kind: shape.kind })}
                    suggestions={coverChoices}
                    onClose={() => setPickingCover(false)}
                    onPick={(url) => { setCover(url); setCoverTouched(true); }}
                  />
                </Suspense>
              )}
            </div>
          )}

          <label style={{ ...lblSt, marginTop: 8 }}>Fields</label>
          <MappingRow name="Label" mapping={labelMapping} clip={clip} onChange={setLabelMapping} />
          {Object.entries(mappings).map(([fieldId, m]) => (
            <MappingRow key={fieldId} name={fieldsById[fieldId]?.name || fieldId} mapping={m} clip={clip}
              onChange={(next) => setMappings((p) => ({ ...p, [fieldId]: next }))}
              onRemove={() => setMappings((p) => { const n = { ...p }; delete n[fieldId]; return n; })} />
          ))}
          {adding ? (
            <Suspense fallback={<div style={{ fontSize: 11, color: "var(--text-muted, #aaa)" }}>Loading fields…</div>}>
            <FieldSelect
              fields={fields.filter((f) => !mappedIds.has(f.id))}
              value={null} noneLabel="pick a field…" ariaLabel="Add a field"
              onChange={(id) => { if (id) setMappings((p) => ({ ...p, [id]: { source: "none" } })); setAdding(false); }}
            />
            </Suspense>
          ) : (
            <button type="button" onClick={() => setAdding(true)} style={linkBtnSt}>+ field…</button>
          )}

          {destination && (
            <div data-testid="preset-actions" style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
              {savedPreset && (
                <button type="button" onClick={updatePreset} style={linkBtnSt}>Update “{savedPreset.name}”</button>
              )}
              <button type="button" onClick={savePreset} style={linkBtnSt}>Save as preset…</button>
              {savedPreset && (
                <button type="button" onClick={removePreset} style={{ ...linkBtnSt, color: "var(--danger, #f87171)" }}>Delete preset</button>
              )}
            </div>
          )}
          {notice && <div style={{ fontSize: 11, color: "var(--text-muted, #aaa)", marginTop: 4 }}>{notice}</div>}
        </section>
      )}

      {error && <p role="alert" style={{ color: "var(--danger, #f87171)", fontSize: 11 }}>{error}</p>}

      <footer style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
        <button type="button" onClick={() => window.close()} disabled={busy} style={btnSt}>Cancel</button>
        <button type="button" onClick={submit} disabled={!canClip} style={{ ...btnSt, ...primarySt, opacity: canClip ? 1 : 0.5 }}>Clip</button>
      </footer>
    </Shell>
  );
}

// One mapping row: which part of the clip, what to do to it, and THE VALUE it
// will write — editable, because a mapping that silently resolves to empty is
// this screen's failure mode (spec §4). An edit is a value for THIS clip only.
// An edited row is the user's now: it keeps what they typed when the
// destination changes, instead of leaving with the destination's rows.
const touched = ({ fromShape, ...m }) => m; // eslint-disable-line no-unused-vars

function MappingRow({ name, mapping, clip, onChange, onRemove }) {
  const shown = mapping.override ?? (mapping.auto ? mapping.value : resolveMapping(clip, mapping));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 6 }}>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <span style={{ fontSize: 11, minWidth: 90, flex: "0 0 auto", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {name}{mapping.auto ? <span style={{ color: "var(--text-faint, #888)" }}> (auto)</span> : null}
        </span>
        <select aria-label={`source for ${name}`} value={mapping.source || "none"} style={miniSelSt}
          onChange={(e) => onChange({ source: e.target.value, transform: mapping.transform, ...(e.target.value === "literal" ? { value: shown || "" } : null) })}>
          {SHARE_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select aria-label={`transform for ${name}`} value={mapping.transform || "none"} style={miniSelSt}
          disabled={mapping.source === "literal"}
          onChange={(e) => onChange({ ...touched(mapping), transform: e.target.value, override: undefined })}>
          {SHARE_TRANSFORMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        {onRemove && <button type="button" onClick={onRemove} title="remove" aria-label={`remove ${name}`} style={linkBtnSt}>×</button>}
      </div>
      <input aria-label={`value for ${name}`} value={shown ?? ""} style={inputSt}
        placeholder={mapping.source === "none" ? "type a value" : "(empty — nothing will be written)"}
        onChange={(e) => onChange(mapping.source === "literal"
          ? { source: "literal", value: e.target.value }
          : { ...touched(mapping), override: e.target.value })} />
    </div>
  );
}

const lblSt = { fontSize: 11, color: "var(--text-faint, #888)", display: "block", marginBottom: 2 };
const inputSt = { width: "100%", boxSizing: "border-box", padding: "4px 6px", background: "var(--input-bg, #1f2126)", color: "var(--text-primary, #eee)", border: "1px solid var(--input-border, #3a3d44)", borderRadius: 4, fontSize: 12 };
const miniSelSt = { ...inputSt, width: "auto", padding: "2px 4px", fontSize: 11 };
const rowSt = { display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "2px 0" };
const destRowSt = { display: "flex", justifyContent: "space-between", gap: 8, width: "100%", textAlign: "left", padding: "4px 6px", background: "transparent", color: "var(--text-primary, #eee)", border: 0, borderBottom: "1px solid var(--border-default, #2a2d33)", cursor: "pointer", fontSize: 12 };
const linkBtnSt = { background: "transparent", border: 0, color: "var(--link, #8ab4ff)", cursor: "pointer", fontSize: 11, padding: "2px 4px" };
const btnSt = { padding: "5px 14px", borderRadius: 4, border: "1px solid var(--border-default, #3a3d44)", background: "var(--surface-2, #25282e)", color: "var(--text-primary, #eee)", cursor: "pointer", fontSize: 12 };
const primarySt = { background: "var(--accent, #3b82f6)", borderColor: "var(--accent, #3b82f6)", color: "#fff" };

// THE WINDOW OWNS ITS OWN SCROLLING. `index.css` locks the page —
// `html, body, #root { height: 100%; overflow: hidden }` — which is right for a
// grid workspace and wrong here: this renders inside that same `#root`, so a
// form taller than the popup had everything past ~700px UNREACHABLE, including
// "Save as preset…" (user, 2026-09-29: "fix the share window to be scrollable").
//
// `#root` is a flex COLUMN, so `minHeight: 0` is the load-bearing part — without
// it a flex child refuses to shrink below its content and no scrollbar ever
// appears, however much overflow it has.
function Shell({ children }) {
  return (
    <div data-testid="share-shell" style={{
      font: "13px/1.5 system-ui, sans-serif", color: "var(--text-primary, #eee)",
      background: "var(--body-bg, #16181c)", padding: 16, boxSizing: "border-box",
      flex: "1 1 auto", minHeight: 0, height: "100%",
      overflowY: "auto", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch",
    }}>
      <div style={{ maxWidth: 520, margin: "0 auto" }}>{children}</div>
    </div>
  );
}
