import React, { useState, useContext, useMemo } from "react";
import CategoryPathPicker from "../CategoryPathPicker";
import { COLLECTION_PICKER_CONFIG, buildRecordKeyPickerConfig } from "../categoryRegistry";
import ConditionGroup from "../../blocks/ConditionGroup";
import { GridActionsContext } from "../../GridActionsContext";

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

export default function SelectOptionsSourceEditor({ source, onChange }) {
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
  const { fieldsById, modulesById, occurrencesById } = useContext(GridActionsContext);

  const find = source?.find || { over: "$allInstances", predicate: { rules: [] }, valuePath: "label" };

  function patch(p) {
    onChange({ ...source, mode: "find", find: { ...find, ...p } });
  }

  const fields = useMemo(() => Object.values(fieldsById), [fieldsById]);
  const leftConfig = useMemo(() => buildRecordKeyPickerConfig(find.over), [find.over]);

  const sectionLabel = { fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", marginBottom: 3 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <div style={sectionLabel}>Search in</div>
        <CategoryPathPicker
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
        <CategoryPathPicker
          value={find.valuePath}
          config={leftConfig}
          onChange={(valuePath) => patch({ valuePath })}
        />
      </div>

      <div>
        <div style={sectionLabel}>Grab label (optional — same as value when empty)</div>
        <CategoryPathPicker
          value={find.labelPath || ""}
          config={leftConfig}
          onChange={(labelPath) => patch({ labelPath: labelPath || undefined })}
        />
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <div style={sectionLabel}>Sort by (optional)</div>
          <CategoryPathPicker
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
    </div>
  );
}
