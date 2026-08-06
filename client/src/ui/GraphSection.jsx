// ui/GraphSection.jsx
//
// HeaderDropdown section configuring a graph (`occurrence.meta.graph`) — the
// chart type, how rows map to slices, and any hardcoded values. Sibling of
// FeedSection: a feed decides WHICH occurrences are the graph's rows, this
// decides how those rows are DRAWN.
//
// THIS IS WHAT MAKES THE FEELING WHEEL DATA RATHER THAN CODE. The emotions
// wheel is a sunburst whose rings come from a `Parent Emotion` field; a chart of
// anything else is the same container with different values picked here. Nothing
// in this file — or in the renderer — knows what an emotion is, which is the
// property `noDomainKnowledge.test.js` guards.
//
// A LIVE READOUT, not a preview. Authoring an encoding is easy to get subtly
// wrong (a parent field that names rows off this graph, a value field nothing
// carries), and a chart failing that way looks like a chart — just the wrong
// one. So the header reports what the CURRENT spec actually produces: how many
// roots, how many rows reached, how deep, and every warning buildGraphData
// raised. That is the same data the chart is drawing from, not a re-derivation.
import React, { useCallback, useMemo } from "react";
import { BarChart3, Plus, X } from "lucide-react";
import { useGridActions } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { CHART_TYPES } from "../helpers/graphOption";
import { buildGraphData } from "../helpers/graphData";

const inputStyle = {
  width: "100%", boxSizing: "border-box",
  background: "var(--input-bg, rgba(0,0,0,0.25))",
  border: "1px solid var(--border-subtle)", borderRadius: 4,
  color: "var(--text-primary)", fontSize: 11, fontFamily: "var(--font-mono)",
  padding: "3px 6px",
};
const labelStyle = {
  fontSize: 9, color: "var(--text-faint)", fontFamily: "var(--font-mono)",
  textTransform: "uppercase", letterSpacing: "0.05em",
};

const DEFAULT_SPEC = {
  type: "sunburst",
  encoding: { category: null, value: null, series: null, children: null, parent: null, level: null },
  literals: [],
};

// One row of the encoding form. `null` is a real, meaningful choice for every
// one of these (label / tally / no split / flat), so the empty option is
// labelled with what it MEANS rather than left blank.
function EncodingRow({ label, hint, value, options, onChange, emptyLabel }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ ...labelStyle, flex: "0 0 74px" }} title={hint}>{label}</div>
      <select value={value || ""} onChange={(e) => onChange(e.target.value || null)} style={{ ...inputStyle, flex: 1 }}>
        <option value="">{emptyLabel}</option>
        {options.map((f) => <option key={f.id} value={f.id}>{f.name || f.id.slice(0, 8)}</option>)}
      </select>
    </div>
  );
}

export default function GraphSection({ occurrence }) {
  const { dispatch, socket, occurrencesById, modulesById, fieldsById } = useGridActions() || {};
  const spec = occurrence?.meta?.graph || null;

  const write = useCallback((nextSpec) => {
    if (!occurrence?.id) return;
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      // Merged into the EXISTING meta, never replacing it: `meta.graph.highlight`
      // is written by an operation (that is how a picked slice stays lit), and a
      // whole-meta write from this form would silently drop it — along with
      // anything else the occurrence carries.
      occurrence: { id: occurrence.id, meta: { ...(occurrence.meta || {}), graph: nextSpec } },
      emit: true,
    });
  }, [occurrence?.id, occurrence?.meta, dispatch, socket]);

  const patch = useCallback((p) => write({ ...DEFAULT_SPEC, ...(spec || {}), ...p }), [spec, write]);
  const patchEncoding = useCallback(
    (p) => patch({ encoding: { ...(spec?.encoding || {}), ...p } }),
    [spec, patch],
  );

  const fields = useMemo(
    () => Object.values(fieldsById || {}).sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [fieldsById],
  );
  const occurrenceFields = useMemo(() => fields.filter((f) => f.type === "occurrence"), [fields]);

  // What the CURRENT spec actually draws, from the same function the chart uses.
  const readout = useMemo(() => {
    if (!spec || !occurrence?.id) return null;
    try {
      const { nodes, warnings } = buildGraphData(occurrence, { occurrencesById, modulesById, fieldsById });
      const count = (ns) => ns.reduce((n, x) => n + 1 + count(x.children || []), 0);
      const depth = (ns, d = 1) => (ns.length ? Math.max(...ns.map((x) => depth(x.children || [], d + 1))) : d - 1);
      return { roots: nodes.length, rows: count(nodes), depth: depth(nodes), warnings };
    } catch (e) {
      return { error: String(e?.message || e) };
    }
  }, [spec, occurrence, occurrencesById, modulesById, fieldsById]);

  if (!occurrence?.id) return null;

  const nested = CHART_TYPES.find((t) => t.id === (spec?.type || "sunburst"))?.nested;
  const literals = spec?.literals || [];

  return (
    <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border-subtle)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
          fontSize: 10, fontWeight: 600, color: "var(--text-muted)",
          fontFamily: "var(--font-mono)", letterSpacing: "0.05em", textTransform: "uppercase",
        }}>
          <BarChart3 size={11} /> Graph
          {readout && !readout.error && (
            <span style={{ color: "var(--text-faint)", textTransform: "none", letterSpacing: 0 }}>
              · {readout.roots} root{readout.roots === 1 ? "" : "s"} · {readout.rows} row{readout.rows === 1 ? "" : "s"}
              {readout.depth > 1 ? ` · ${readout.depth} deep` : ""}
            </span>
          )}
        </div>
        {!spec && (
          <button onClick={() => write(DEFAULT_SPEC)} style={{
            fontSize: 10, fontFamily: "var(--font-mono)", cursor: "pointer",
            padding: "2px 8px", borderRadius: 10,
            border: "1px solid var(--border-subtle)", background: "transparent", color: "var(--text-muted)",
          }}>Configure</button>
        )}
      </div>

      {spec && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ ...labelStyle, flex: "0 0 74px" }}>Type</div>
            <select value={spec.type || "sunburst"} onChange={(e) => patch({ type: e.target.value })} style={{ ...inputStyle, flex: 1 }}>
              {CHART_TYPES.map((t) => <option key={t.id} value={t.id} title={t.desc}>{t.label}</option>)}
            </select>
          </div>

          <EncodingRow
            label="Label" hint="Which field names each slice. Empty = the occurrence's own label."
            emptyLabel="the occurrence's label"
            value={spec.encoding?.category} options={fields}
            onChange={(v) => patchEncoding({ category: v })}
          />
          <EncodingRow
            label="Value" hint="Which field sizes each slice. Empty = every row counts as one."
            emptyLabel="count the rows"
            value={spec.encoding?.value} options={fields}
            onChange={(v) => patchEncoding({ value: v })}
          />
          <EncodingRow
            label="Split by" hint="Optional: draw one series per distinct value of this field."
            emptyLabel="one series"
            value={spec.encoding?.series} options={fields}
            onChange={(v) => patchEncoding({ series: v })}
          />

          {/* Hierarchy only matters where the chart can draw one. */}
          {nested && (
            <>
              <div style={{ ...labelStyle, marginTop: 2 }}>Rings come from…</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ ...labelStyle, flex: "0 0 74px" }}>Nesting</div>
                <select
                  value={spec.encoding?.children === "occurrences" ? "occurrences" : ""}
                  onChange={(e) => patchEncoding({ children: e.target.value || null })}
                  style={{ ...inputStyle, flex: 1 }}
                >
                  <option value="">off</option>
                  <option value="occurrences">the occurrence tree</option>
                </select>
              </div>
              <EncodingRow
                label="Parent" hint="A field on each row naming its parent row — a hierarchy from a FLAT board."
                emptyLabel="no parent field"
                value={spec.encoding?.parent} options={occurrenceFields}
                onChange={(v) => patchEncoding({ parent: v })}
              />
              <EncodingRow
                label="Level" hint="Optional: which ring a row declares it belongs to. Reported, not used — a disagreement with the tree is worth seeing."
                emptyLabel="not tracked"
                value={spec.encoding?.level} options={fields}
                onChange={(v) => patchEncoding({ level: v })}
              />
            </>
          )}

          {/* Hardcoded values — the third data source, alongside a feed and dragging. */}
          <div style={{ ...labelStyle, marginTop: 2, display: "flex", justifyContent: "space-between" }}>
            <span>Fixed values</span>
            <button
              onClick={() => patch({ literals: [...literals, { name: "", value: 0 }] })}
              title="Add a value that is not an occurrence — a target line, a constant"
              style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 0 }}
            >
              <Plus size={11} />
            </button>
          </div>
          {literals.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input
                value={l.name || ""} placeholder="name"
                onChange={(e) => {
                  const next = [...literals]; next[i] = { ...l, name: e.target.value }; patch({ literals: next });
                }}
                style={{ ...inputStyle, flex: 2 }}
              />
              <input
                type="number" value={l.value ?? ""} placeholder="value"
                onChange={(e) => {
                  const next = [...literals];
                  next[i] = { ...l, value: e.target.value === "" ? null : Number(e.target.value) };
                  patch({ literals: next });
                }}
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                onClick={() => patch({ literals: literals.filter((_, j) => j !== i) })}
                style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", padding: 2 }}
              >
                <X size={11} />
              </button>
            </div>
          ))}

          {/* Surfaced, never swallowed — "this row contributed nothing" is
              exactly the kind of thing a chart cannot show you. */}
          {readout?.error && (
            <div style={{ fontSize: 10, color: "rgb(248,113,113)", fontFamily: "var(--font-mono)" }}>
              {readout.error}
            </div>
          )}
          {readout?.warnings?.length > 0 && (
            <div style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
              {readout.warnings.length} row{readout.warnings.length === 1 ? "" : "s"} contributed nothing
              <div style={{ marginTop: 2, opacity: 0.8 }}>
                {readout.warnings.slice(0, 3).map((w, i) => <div key={i}>· {w.why}</div>)}
                {readout.warnings.length > 3 && <div>· +{readout.warnings.length - 3} more</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
