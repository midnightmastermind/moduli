import React, { useState, useMemo, useEffect } from "react";
import { providerKeysFromSamples } from "../../helpers/providerFieldMap.js";
import DrilldownPicker from "../DrilldownPicker";
import { COLLECTION_PICKER_CONFIG, buildRecordKeyPickerConfig } from "../categoryRegistry";
import ConditionGroup from "../../blocks/ConditionGroup";
import { useGridActions } from "../../GridActionsContext";
import { resolveOptions } from "../../helpers/optionsResolver";

const MODES = [
  { key: "manual", label: "Manual" },
  { key: "range",  label: "Range" },
  { key: "find",   label: "Find" },
];

const pillStyle = (active) => ({
  padding: "3px 10px",
  borderRadius: 999,
  fontSize: 11,
  fontFamily: "monospace",
  background: active ? "var(--accent-blue-bg)" : "var(--input-bg)",
  border: `1px solid ${active ? "var(--accent-blue-border)" : "var(--input-border)"}`,
  color: active ? "var(--accent-blue-text)" : "var(--text-muted)",
  cursor: "pointer",
});

export default function SelectOptionsSourceEditor({ source, onChange, fieldType = "select" }) {
  const mode = source?.mode || "manual";

  function setMode(next) {
    if (next === mode) return;
    if (next === "manual") onChange({ mode: "manual", values: [] });
    else if (next === "range") onChange({ mode: "range", range: { start: 0, end: 10, step: 1 } });
    else if (next === "find") onChange({ mode: "find", find: { over: "$allInstances", predicate: { rules: [] }, valuePath: "label" } });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {MODES.map(m => (
          <button key={m.key} type="button" onClick={() => setMode(m.key)} style={pillStyle(mode === m.key)}>
            {m.label}
          </button>
        ))}
      </div>
      {mode === "manual" && <ManualBody source={source} onChange={onChange} />}
      {mode === "range"  && <RangeBody  source={source} onChange={onChange} />}
      {mode === "find"   && <FindBody   source={source} onChange={onChange} />}
      {/* Chip-display config is occurrence-only — picks which fields show
          on the SELECTED occurrence chip's subtitle row. Independent of
          options-source mode (works in both find & manual modes) so the
          editor lives at the bottom of the panel. */}
      {fieldType === "occurrence" && <ChipDisplayBody source={source} onChange={onChange} />}
      {/* Looping in an outside search is a property of WHERE THE OPTIONS COME
          FROM, so it lives beside the query rather than in a settings panel of
          its own. Occurrence-only for the same reason the select call site in
          Field.jsx is unwired: an import MINTS A ROW, and a select field stores
          strings. */}
      {fieldType === "occurrence" && <SearchProviderBody source={source} onChange={onChange} />}
    </div>
  );
}

// ─── ChipDisplayBody — pick which fields render on selected occurrence chips ─
// Persists to `source.chipDisplay = { fieldIds: string[], showMedia: bool, showLabel: bool }`.
// When chipDisplay is null/missing, Field.jsx's OccurrenceOption falls back
// to the auto-derived "first 3 non-hidden bindings" heuristic — so this UI
// is purely opt-in. Empty fieldIds + showMedia:true is a valid "media only"
// chip; empty everything + showLabel:false is a "blank" chip (probably bad
// but allowed — UX feedback comes from the live preview).
function ChipDisplayBody({ source, onChange }) {
  const { fieldsById } = useGridActions();
  const cd = source?.chipDisplay || { fieldIds: [], showMedia: true, showLabel: true };
  const fields = useMemo(
    () => Object.values(fieldsById || {})
      .filter(f => !f.trashed)
      .sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [fieldsById]
  );

  function patchCD(p) {
    onChange({ ...source, chipDisplay: { ...cd, ...p } });
  }
  function toggleField(fid) {
    const next = cd.fieldIds?.includes(fid)
      ? cd.fieldIds.filter(x => x !== fid)
      : [...(cd.fieldIds || []), fid];
    patchCD({ fieldIds: next });
  }
  function clear() {
    onChange({ ...source, chipDisplay: undefined });
  }

  const sectionLabel = { fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", marginBottom: 3 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4, paddingTop: 8, borderTop: "1px dashed var(--border-subtle)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={sectionLabel}>Selected chip display</div>
        {source?.chipDisplay && (
          <button onClick={clear} type="button" style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-faint)", fontSize: 10, fontFamily: "monospace",
            padding: "0 4px",
          }} title="Clear chip display config (revert to auto-derive)">
            ✕ auto
          </button>
        )}
      </div>
      <div style={{ display: "flex", gap: 10, fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
          <input type="checkbox" checked={cd.showLabel !== false} onChange={(e) => patchCD({ showLabel: e.target.checked })} />
          Label
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
          <input type="checkbox" checked={cd.showMedia !== false} onChange={(e) => patchCD({ showMedia: e.target.checked })} />
          Media
        </label>
      </div>
      <div style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "monospace" }}>
        Fields ({cd.fieldIds?.length || 0} selected — order matters; empty = no field chips)
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxHeight: 140, overflowY: "auto", padding: 2, border: "1px solid var(--border-subtle)", borderRadius: 4 }}>
        {fields.length === 0 && (
          <div style={{ fontSize: 10, color: "var(--text-faint)", fontStyle: "italic", padding: "4px 6px" }}>
            No fields on this grid.
          </div>
        )}
        {fields.map(f => {
          const selected = cd.fieldIds?.includes(f.id);
          return (
            <button
              key={f.id} type="button" onClick={() => toggleField(f.id)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 3,
                padding: "2px 7px", borderRadius: 999, fontSize: 10, fontFamily: "monospace",
                background: selected ? "var(--accent-blue-bg)" : "var(--input-bg)",
                border: `1px solid ${selected ? "var(--accent-blue-border)" : "var(--input-border)"}`,
                color: selected ? "var(--accent-blue-text)" : "var(--text-muted)",
                cursor: "pointer",
              }}
              title={`${f.name} · ${f.type}${selected ? ` · index ${cd.fieldIds.indexOf(f.id) + 1}` : ""}`}
            >
              {selected && <span style={{ fontSize: 8, opacity: 0.7 }}>{cd.fieldIds.indexOf(f.id) + 1}.</span>}
              {f.name || "(unnamed)"}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ManualBody({ source, onChange }) {
  const values = Array.isArray(source?.values) ? source.values : [];
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (!v) return;
    onChange({ ...source, mode: "manual", values: [...values, v] });
    setDraft("");
  }
  function remove(i) {
    onChange({ ...source, mode: "manual", values: values.filter((_, j) => j !== i) });
  }

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
        {values.map((v, i) => (
          <span key={i} style={{
            display: "inline-flex", alignItems: "center", gap: 3,
            padding: "1px 7px", borderRadius: 999, fontSize: 10, fontFamily: "monospace",
            background: "var(--border-subtle)", border: "1px solid var(--border-default)",
            color: "var(--text-muted)",
          }}>
            {String(v)}
            <button onClick={() => remove(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,100,100,0.6)", padding: 0, lineHeight: 1 }}>✕</button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder="Add option (Enter)"
          style={{
            flex: 1, height: 28, fontSize: 11, fontFamily: "monospace",
            background: "var(--input-bg)", border: "1px solid var(--input-border)",
            borderRadius: 5, color: "var(--text-primary)", padding: "0 8px", outline: "none",
          }}
        />
        <button onClick={add} style={{
          padding: "0 10px", borderRadius: 4, fontSize: 10, fontFamily: "monospace",
          background: "var(--input-bg)", border: "1px solid var(--input-border)",
          color: "var(--text-muted)", cursor: "pointer",
        }}>Add</button>
      </div>
    </div>
  );
}

function RangeBody({ source, onChange }) {
  const range = source?.range || { start: 0, end: 10, step: 1 };

  function set(key, value) {
    const num = value === "" ? 0 : Number(value);
    onChange({ ...source, mode: "range", range: { ...range, [key]: num } });
  }

  const preview = [];
  if (range.step > 0 && range.end >= range.start) {
    for (let v = range.start; v <= range.end && preview.length < 11; v += range.step) preview.push(v);
  }
  const overflow = preview.length > 10;
  const shown = overflow ? preview.slice(0, 10) : preview;

  const inputStyle = {
    width: 60, height: 28, fontSize: 11, fontFamily: "monospace",
    background: "var(--input-bg)", border: "1px solid var(--input-border)",
    borderRadius: 5, color: "var(--text-primary)", padding: "0 8px", outline: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", display: "inline-flex", flexDirection: "column", gap: 2 }}>
          Start <input type="number" value={range.start} onChange={(e) => set("start", e.target.value)} style={inputStyle} />
        </label>
        <label style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", display: "inline-flex", flexDirection: "column", gap: 2 }}>
          End <input type="number" value={range.end} onChange={(e) => set("end", e.target.value)} style={inputStyle} />
        </label>
        <label style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", display: "inline-flex", flexDirection: "column", gap: 2 }}>
          Step <input type="number" value={range.step} onChange={(e) => set("step", e.target.value)} style={inputStyle} />
        </label>
      </div>
      <div style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "monospace" }}>
        Preview: {shown.join(", ")}{overflow ? ", …" : ""}
      </div>
    </div>
  );
}
function FindBody({ source, onChange }) {
  const ctx = useGridActions();
  const { fieldsById, modulesById, occurrencesById, foldersById } = ctx;

  const find = source?.find || { over: "$allInstances", predicate: { rules: [] }, valuePath: "label" };

  function patch(p) {
    onChange({ ...source, mode: "find", find: { ...find, ...p } });
  }

  const fields = useMemo(() => Object.values(fieldsById), [fieldsById]);
  const leftConfig = useMemo(() => buildRecordKeyPickerConfig(find.over), [find.over]);

  const preview = useMemo(() => {
    const draftField = { type: "select", meta: { optionsSource: { mode: "find", find } } };
    return resolveOptions(draftField, {
      occurrencesById: occurrencesById || {},
      modulesById: modulesById || {},
      fieldsById: fieldsById || {},
      foldersById: foldersById || {},
    });
  }, [find, occurrencesById, modulesById, fieldsById, foldersById]);

  const sectionLabel = { fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", marginBottom: 3 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <div style={sectionLabel}>Search in</div>
        <DrilldownPicker
          value={find.over}
          config={COLLECTION_PICKER_CONFIG}
          onChange={(over) => patch({ over })}
        />
      </div>

      <div>
        <div style={sectionLabel}>Where</div>
        <ConditionGroup
          group={find.predicate || { rules: [] }}
          onChange={(predicate) => patch({ predicate })}
          sources={[]}
          fields={fields}
          fieldsById={fieldsById}
          modulesById={modulesById}
          occurrencesById={occurrencesById}
          localVars={[]}
          leftConfig={leftConfig}
        />
      </div>

      <div>
        <div style={sectionLabel}>Grab value</div>
        <DrilldownPicker
          value={find.valuePath}
          config={leftConfig}
          onChange={(valuePath) => patch({ valuePath })}
        />
      </div>

      <div>
        <div style={sectionLabel}>Grab label (optional — same as value when empty)</div>
        <DrilldownPicker
          value={find.labelPath || ""}
          config={leftConfig}
          onChange={(labelPath) => patch({ labelPath: labelPath || undefined })}
        />
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <div style={sectionLabel}>Sort by (optional)</div>
          <DrilldownPicker
            value={find.sortPath || ""}
            config={leftConfig}
            onChange={(sortPath) => patch({ sortPath: sortPath || undefined })}
          />
        </div>
        <div>
          <div style={sectionLabel}>Dir</div>
          <select
            value={find.sortDir || "asc"}
            onChange={(e) => patch({ sortDir: e.target.value })}
            style={{ height: 28, fontSize: 11, fontFamily: "monospace", background: "var(--input-bg)", border: "1px solid var(--input-border)", borderRadius: 5, color: "var(--text-primary)", padding: "0 8px", outline: "none" }}
          >
            <option value="asc">↑ asc</option>
            <option value="desc">↓ desc</option>
          </select>
        </div>
        <div>
          <div style={sectionLabel}>Limit</div>
          <input
            type="number"
            value={find.limit ?? 100}
            onChange={(e) => patch({ limit: Math.max(1, Number(e.target.value) || 100) })}
            style={{ width: 70, height: 28, fontSize: 11, fontFamily: "monospace", background: "var(--input-bg)", border: "1px solid var(--input-border)", borderRadius: 5, color: "var(--text-primary)", padding: "0 8px", outline: "none" }}
          />
        </div>
      </div>

      <div style={{ marginTop: 4 }}>
        <div style={sectionLabel}>
          Preview: {preview.totalMatched} match{preview.totalMatched === 1 ? "" : "es"}
          {preview.totalMatched > preview.options.length && ` (showing first ${preview.options.length})`}
        </div>
        {preview.options.length === 0 ? (
          <div style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "monospace", fontStyle: "italic" }}>
            No matches — check the predicate.
          </div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>
            {preview.options.slice(0, 10).map((o, i) => (
              <li key={i}>{o.label}{o.label !== String(o.value) ? `  ·  ${o.value}` : ""}</li>
            ))}
            {preview.options.length > 10 && <li style={{ color: "var(--text-faint)" }}>… {preview.options.length - 10} more</li>}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── SearchProviderBody — loop an outside search into this dropdown ──────────
// User, 2026-08-23: *"where we make the query for the dropdown in general, lets
// set that as a toggle with underneath being a mapping selection from the
// fields those searches give, to our own fields. these should be built out as
// optional things to loop in."*
//
// Persists to `source.searchProvider = { enabled, provider, fieldMap }`.
// Absent or `enabled:false` and the dropdown behaves exactly as it always has —
// one list, your own occurrences, no second request. THAT is what makes this
// optional rather than a mode.
//
// **THE PROVIDER LIST COMES FROM THE SERVER, never from a constant here.** A
// provider that needs a key and has none is not listed at all, so the failure
// lands at configuration instead of at the user's keystroke — and a hardcoded
// list would offer one this deployment cannot serve. Custom providers are not
// offered yet (user: *"we will have custom at somepoint but just currently give
// the option to loop in the example services we have"*), so there is no
// free-text entry: every option here is a service the server registered.
function SearchProviderBody({ source, onChange }) {
  const { fieldsById } = useGridActions();
  const cfg = source?.searchProvider || null;
  const enabled = !!cfg?.enabled;

  const [providers, setProviders] = useState([]);
  const [sample, setSample] = useState({ q: "", state: "idle", keys: [], error: null });

  const ourFields = useMemo(
    () => Object.values(fieldsById || {})
      .filter(f => !f.trashed)
      .sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [fieldsById]
  );

  // Only asked for once the section is switched on — an off toggle costs nothing.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch("/api/search/providers", { headers: { Accept: "application/json" } })
      .then(r => r.json())
      .then(j => { if (alive && j?.ok) setProviders(j.providers || []); })
      .catch(() => { /* offline: the picker just stays empty and says so */ });
    return () => { alive = false; };
  }, [enabled]);

  function patch(p) {
    onChange({ ...source, searchProvider: { ...(cfg || { fieldMap: {} }), ...p } });
  }

  function toggle() {
    if (enabled) {
      // Switched OFF keeps the authored mapping rather than deleting it — turning
      // it back on should not mean re-doing the work.
      patch({ enabled: false });
    } else {
      patch({ enabled: true, provider: cfg?.provider || providers[0]?.id || "wikipedia", fieldMap: cfg?.fieldMap || {} });
    }
  }

  // The provider's field NAMES are per-result ("Directed by" for a film,
  // "Authors" for a book), so they cannot be listed in advance. A sample lookup
  // is the honest way to populate the mapping UI: search once, read back the
  // keys that result actually carried.
  async function runSample() {
    const q = sample.q.trim();
    if (!q || !cfg?.provider) return;
    setSample(s => ({ ...s, state: "loading", error: null }));
    try {
      const sr = await fetch(`/api/search/${encodeURIComponent(cfg.provider)}?q=${encodeURIComponent(q)}&limit=1`)
        .then(r => r.json());
      const first = sr?.results?.[0];
      if (!first) { setSample(s => ({ ...s, state: "done", keys: [], error: "no results for that query" })); return; }
      const dr = await fetch(
        `/api/search/${encodeURIComponent(cfg.provider)}/detail?title=${encodeURIComponent(first.title)}`
        + `&externalId=${encodeURIComponent(first.externalId || "")}`
      ).then(r => r.json());
      const keys = providerKeysFromSamples([dr?.result].filter(Boolean));
      setSample(s => ({ ...s, state: "done", keys, error: keys.length ? null : "that result carried no fields" }));
    } catch (e) {
      setSample(s => ({ ...s, state: "done", keys: [], error: e.message }));
    }
  }

  const fieldMap = cfg?.fieldMap || {};
  // Show every key the sample found PLUS anything already mapped, so a mapping
  // authored against a different article does not silently vanish from the UI.
  const rows = useMemo(() => {
    const seen = new Map(sample.keys.map(k => [k.key, k]));
    for (const k of Object.keys(fieldMap)) if (!seen.has(k)) seen.set(k, { key: k, seen: 0 });
    return [...seen.values()];
  }, [sample.keys, fieldMap]);

  return (
    <div style={{ borderTop: "1px solid var(--input-border)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", cursor: "pointer" }}>
        <input type="checkbox" checked={enabled} onChange={toggle} />
        Also search an outside service
      </label>

      {enabled && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)" }}>service</span>
            <select
              value={cfg?.provider || ""}
              onChange={e => patch({ provider: e.target.value })}
              style={{ fontSize: 11, fontFamily: "monospace", background: "var(--input-bg)", color: "var(--text-primary)", border: "1px solid var(--input-border)", borderRadius: 4, padding: "2px 6px" }}
            >
              {providers.length === 0 && <option value="">(none available)</option>}
              {providers.map(p => <option key={p.id} value={p.id}>{p.label || p.id}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", lineHeight: 1.4 }}>
            Your own occurrences still come first — this adds a second section underneath them.
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input
              value={sample.q}
              onChange={e => setSample(s => ({ ...s, q: e.target.value }))}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); runSample(); } }}
              placeholder="try a search to see what it returns…"
              style={{ flex: 1, fontSize: 11, fontFamily: "monospace", background: "var(--input-bg)", color: "var(--text-primary)", border: "1px solid var(--input-border)", borderRadius: 4, padding: "2px 6px" }}
            />
            <button type="button" onClick={runSample} disabled={sample.state === "loading"} style={pillStyle(false)}>
              {sample.state === "loading" ? "…" : "check"}
            </button>
          </div>
          {sample.error && (
            <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)" }}>{sample.error}</div>
          )}

          {rows.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)" }}>
                fill these fields on an imported row
              </div>
              {rows.map(({ key }) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ flex: "0 0 44%", fontSize: 10, fontFamily: "monospace", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={key}>
                    {key}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>→</span>
                  <select
                    value={fieldMap[key] || ""}
                    onChange={e => {
                      const next = { ...fieldMap };
                      // Mapping to nothing REMOVES the entry rather than storing
                      // an empty string, so the stored config says what it means.
                      if (e.target.value) next[key] = e.target.value; else delete next[key];
                      patch({ fieldMap: next });
                    }}
                    style={{ flex: 1, fontSize: 10, fontFamily: "monospace", background: "var(--input-bg)", color: "var(--text-primary)", border: "1px solid var(--input-border)", borderRadius: 4, padding: "1px 4px" }}
                  >
                    <option value="">— don't import —</option>
                    {ourFields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
