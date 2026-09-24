// ui/commandCenter/ImportsTab.jsx
//
// SHARE RULES, authored where you would look for them (spec D6): what happens
// to a link, a photo or a calendar invite when you share it into Moduli.
//
// A rule IS an operation (trigger `{ eventType: "onShare", shareType }`) that
// the SERVER runs when a share arrives (server/services/shareRules.js). This
// tab is a share-shaped view over those operations: it creates and saves them
// through the same CommitHelpers path the Operations tab uses, and edits their
// steps with the same PipelineEditor — there is no second rule editor. The
// decisions (ordering, one rule per type, the halt checkbox) live in
// helpers/shareRulesUi.js, where they are tested.
//
// "Recent shares" reads `grid.shareLog`, which the server appends to for every
// share, failures included (D16, §12). It holds metadata only, so there is
// deliberately no way to repeat a share from it.
import React, { useMemo, useState, useEffect } from "react";
import { Plus, Trash2, Save, Inbox } from "lucide-react";
import { useGridActions } from "../../GridActionsContext";
import { uid } from "../../uid";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import { PipelineEditor } from "../../blocks";
import { AUTH_KEYS } from "../../helpers/authStorage";
import {
  shareRulesFrom, freeShareTypes, newShareRule, shareTriggerOf, isCatchAll,
  haltsChain, setHaltsChain, markUserEdited, recentShares, sharePropsFor, SHARE_TYPES,
} from "../../helpers/shareRulesUi";

const mono = { fontFamily: "monospace" };
const small = { fontSize: 11, color: "var(--text-muted)", ...mono };
const btn = {
  fontSize: 11, padding: "3px 8px", borderRadius: 4, cursor: "pointer", ...mono,
  border: "1px solid var(--border-default)", background: "var(--surface-2, transparent)", color: "var(--text-primary)",
};

const typeLabel = (t) => (t === "*" ? "Anything else" : SHARE_TYPES.find(x => x.id === t)?.label || t || "—");

function SubTabs({ value, onChange, logCount }) {
  const tabs = [["rules", "Rules"], ["log", `Recent shares${logCount ? ` (${logCount})` : ""}`]];
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
      {tabs.map(([id, label]) => (
        <button key={id} onClick={() => onChange(id)}
          style={{ ...btn, fontWeight: value === id ? 700 : 400, opacity: value === id ? 1 : 0.7 }}>
          {label}
        </button>
      ))}
    </div>
  );
}

function RuleEditor({ rule, fields, onSave, onDelete }) {
  const { modulesById, occurrencesById, fieldsById, operationsById } = useGridActions();
  const [local, setLocal] = useState(rule);
  useEffect(() => { setLocal(rule); }, [rule?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const shareType = shareTriggerOf(local)?.shareType;
  const catchAll = isCatchAll(local);
  const dirty = JSON.stringify(local) !== JSON.stringify(rule);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input value={local.name || ""} onChange={e => setLocal(p => ({ ...p, name: e.target.value }))}
          style={{ ...mono, fontSize: 12, flex: "1 1 180px", padding: "3px 6px",
            background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border-default)", borderRadius: 4 }} />
        <span style={small}>when shared: <b>{typeLabel(shareType)}</b></span>
        <label style={small}>
          <input type="checkbox" checked={local.enabled !== false}
            onChange={e => setLocal(p => ({ ...p, enabled: e.target.checked }))} /> on
        </label>
        {!catchAll && (
          <label style={small} title="Adds a final step that sets $share.handled, so the catch-all does not ALSO run">
            <input type="checkbox" checked={haltsChain(local.pipeline)}
              onChange={e => setLocal(p => ({ ...p, pipeline: setHaltsChain(p.pipeline, e.target.checked, uid()) }))} />
            {" "}stop here (don't also run "Anything else")
          </label>
        )}
        <button style={{ ...btn, opacity: dirty ? 1 : 0.5 }} disabled={!dirty}
          onClick={() => onSave(markUserEdited(local))}><Save size={11} /> Save</button>
        {catchAll ? (
          <span style={small} title="Every grid keeps one catch-all so no share is ever lost (D3). Turn it off instead.">
            (always kept)
          </span>
        ) : (
          <button style={btn} onClick={() => { if (window.confirm(`Delete rule "${local.name}"?`)) onDelete(local.id); }}>
            <Trash2 size={11} /> Delete
          </button>
        )}
      </div>

      <div style={{ ...small, lineHeight: 1.6 }}>
        This rule can read: {sharePropsFor(shareType).map(p => (
          <code key={p} style={{ marginRight: 6, color: "var(--text-primary)" }}>{p}</code>
        ))}
      </div>

      <PipelineEditor
        pipeline={local.pipeline || { sources: [], steps: [] }}
        onChange={(pipeline) => setLocal(p => ({ ...p, pipeline }))}
        fields={fields}
        fieldsById={fieldsById || {}}
        modulesById={modulesById || {}}
        occurrencesById={occurrencesById || {}}
        operationsById={operationsById || {}}
      />
    </div>
  );
}

/** Where a created row ended up: its container's name, or its folder's. */
function useWhere() {
  const { occurrencesById, modulesById, foldersById } = useGridActions();
  return (occId) => {
    const occ = occurrencesById?.[occId];
    if (!occ) return { label: null, where: null };
    const label = occ.label || modulesById?.[occ.moduleId]?.label || null;
    const parentOcc = occ.parentId ? occurrencesById?.[occ.parentId] : null;
    const where = parentOcc
      ? (parentOcc.label || modulesById?.[parentOcc.moduleId]?.label || "a container")
      : (foldersById?.[occ.parentId]?.name ? `${foldersById[occ.parentId].name} folder` : null);
    return { label, where };
  };
}

const STATUS_COLOR = { landed: "var(--success, #16a34a)", nothing: "var(--warning, #d97706)", failed: "var(--danger, #dc2626)" };

function ShareLog({ entries }) {
  const whereOf = useWhere();
  if (!entries.length) {
    return <div style={small}>Nothing shared into this grid yet. Clips from the browser extension and shares from your phone appear here.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {entries.map((e, i) => (
        <div key={`${e.at}-${i}`} style={{ borderLeft: `3px solid ${STATUS_COLOR[e.status] || "var(--border-default)"}`, paddingLeft: 8 }}>
          <div style={{ ...mono, fontSize: 12, color: "var(--text-primary)" }}>
            {e.label || "(no name)"}
          </div>
          <div style={small}>
            {new Date(e.at).toLocaleString()} · {typeLabel(e.type)} · from {e.source || "?"} ·{" "}
            <span style={{ color: STATUS_COLOR[e.status] }}>
              {e.status === "landed" ? "landed" : e.status === "nothing" ? "no rule wrote anything" : "failed"}
            </span>
            {e.halted ? " · stopped after its rule" : ""}
          </div>
          {e.error && <div style={{ ...small, color: STATUS_COLOR.failed }}>{e.error}</div>}
          {(e.rules || []).map(r => (
            <div key={r.ruleId} style={{ ...small, paddingLeft: 8 }}>
              ↳ {r.ruleName || "rule"}{r.ok ? "" : ` — error: ${r.error || "?"}`}
              {(r.created || []).map(c => {
                const { label, where } = whereOf(c.occurrenceId);
                return (
                  <div key={c.occurrenceId} style={{ paddingLeft: 12 }}>
                    {c.status === "updated" ? "updated" : "created"} “{label || c.occurrenceId}”{where ? ` in ${where}` : ""}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Where a share lands when its sender names no grid (the phone/Windows share
// page, the extension without a grid set). Stored on the USER, not the grid —
// `user.meta.share.gridId` via /api/v1/me/share, with the signed-in session as
// the Bearer. Without one, the first share from a new device had nowhere to go
// ("no share grid is configured", 2026-09-24).
export function ShareGridPicker({ grids, fetchImpl = (...a) => fetch(...a) }) {
  const [value, setValue] = useState(undefined);   // undefined = loading
  const [status, setStatus] = useState(null);
  const token = (() => { try { return localStorage.getItem(AUTH_KEYS.token); } catch { return null; } })();
  useEffect(() => {
    if (!token) return;
    let live = true;
    fetchImpl("/api/v1/me/share", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : {})
      .then(j => { if (live) setValue(j?.gridId || ""); })
      .catch(() => { if (live) setValue(""); });
    return () => { live = false; };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!token) return null;
  const save = async (gridId) => {
    setValue(gridId);
    setStatus("saving…");
    try {
      const r = await fetchImpl("/api/v1/me/share", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ gridId: gridId || null }),
      });
      setStatus(r.ok ? "saved" : `failed (${r.status})`);
    } catch (e) { setStatus(`failed (${e.message})`); }
  };
  const options = (grids || []).map(g => ({ id: String(g.id || g._id), name: g.name || g.gridName || `Grid ${String(g.id || g._id).slice(-4)}` }));
  return (
    <label data-testid="share-grid-picker" style={{ ...small, display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
      Shares land in:
      <select value={value ?? ""} disabled={value === undefined} onChange={e => save(e.target.value)}
        style={{ ...btn, padding: "2px 4px" }}>
        <option value="">(the grid this device last had open)</option>
        {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      {status && <span>{status}</span>}
    </label>
  );
}

export function ImportsTab() {
  const { state, socket, dispatch } = useGridActions();
  const gridId = state?.gridId;
  const [sub, setSub] = useState("rules");
  const [selectedId, setSelectedId] = useState(null);
  const [adding, setAdding] = useState(false);

  const rules = useMemo(() => shareRulesFrom(state?.operations || [], gridId), [state?.operations, gridId]);
  const fields = useMemo(() => (state?.fields || []).filter(f => f.gridId === gridId), [state?.fields, gridId]);
  const log = useMemo(() => recentShares(state?.grid), [state?.grid]);
  const selected = rules.find(r => r.id === selectedId) || null;
  const free = freeShareTypes(rules);

  const addRule = (shareType) => {
    const op = newShareRule({ id: uid(), gridId, shareType, sortOrder: rules.length });
    CommitHelpers.createOperation({ dispatch, socket, operation: op });
    setSelectedId(op.id);
    setAdding(false);
  };

  return (
    <div data-testid="imports-tab" style={{ padding: 10, ...mono }}>
      <ShareGridPicker grids={state?.availableGrids} />
      <SubTabs value={sub} onChange={setSub} logCount={log.length} />

      {sub === "log" ? <ShareLog entries={log} /> : (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "0 0 200px", display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={small}>When something is shared into this grid, the rule for its type runs first; “Anything else” catches the rest.</div>
            {rules.map(r => (
              <button key={r.id} onClick={() => setSelectedId(r.id)}
                style={{ ...btn, textAlign: "left", opacity: r.enabled === false ? 0.5 : 1,
                  fontWeight: r.id === selectedId ? 700 : 400 }}>
                <div>{r.name}</div>
                <div style={small}>{typeLabel(shareTriggerOf(r)?.shareType)}{r.enabled === false ? " · off" : ""}</div>
              </button>
            ))}
            {!rules.length && <div style={small}><Inbox size={12} /> No rules yet — the first share creates “Anything else”.</div>}
            {adding ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {free.map(t => <button key={t.id} style={btn} onClick={() => addRule(t.id)}>{t.label}</button>)}
                <button style={{ ...btn, opacity: 0.7 }} onClick={() => setAdding(false)}>cancel</button>
              </div>
            ) : free.length > 0 && (
              <button style={btn} onClick={() => setAdding(true)}><Plus size={11} /> Rule for a type</button>
            )}
          </div>
          <div style={{ flex: "1 1 400px", minWidth: 0 }}>
            {selected ? (
              <RuleEditor rule={selected} fields={fields}
                onSave={(op) => CommitHelpers.updateOperation({ dispatch, socket, operation: op })}
                onDelete={(id) => { CommitHelpers.deleteOperation({ dispatch, socket, operationId: id }); setSelectedId(null); }} />
            ) : (
              <div style={small}>Pick a rule to edit its steps.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
