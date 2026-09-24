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
import { Plus, Trash2, Save, Inbox, ExternalLink, ChevronRight } from "lucide-react";
import { useGridActions } from "../../GridActionsContext";
import { uid } from "../../uid";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import { PipelineEditor } from "../../blocks";
import { AUTH_KEYS } from "../../helpers/authStorage";
import { pickPanelOccurrence } from "../../helpers/lastPanel";
import { openOccurrenceInPanel } from "../../helpers/openOccurrenceInPanel";
import { toast } from "sonner";
import {
  shareRulesFrom, freeShareTypes, newShareRule, shareTriggerOf, isCatchAll,
  haltsChain, setHaltsChain, markUserEdited, recentShares, sharePropsFor, SHARE_TYPES,
} from "../../helpers/shareRulesUi";

const mono = { fontFamily: "monospace" };
const small = { fontSize: 11, color: "var(--text-muted)", ...mono };
const btn = {
  display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "center",
  fontSize: 11, padding: "3px 8px", borderRadius: 4, cursor: "pointer", ...mono,
  border: "1px solid var(--border-default)", background: "var(--surface-2, transparent)", color: "var(--text-primary)",
};

const primaryBtn = { background: "var(--accent-blue-bg, rgba(59,130,246,0.15))", borderColor: "var(--accent-blue-border, #3b82f6)", color: "var(--accent-blue-text, #93c5fd)" };

function TypeChip({ type }) {
  return (
    <span style={{ ...mono, fontSize: 10, padding: "1px 6px", borderRadius: 999, whiteSpace: "nowrap",
      border: "1px solid var(--border-default)", color: "var(--text-primary)" }}>{typeLabel(type)}</span>
  );
}

/** A rule called "Share: link" already says it is for links — a chip would repeat it. */
function namesItsType(rule) {
  const t = shareTriggerOf(rule)?.shareType;
  const word = typeLabel(t).replace(/\s*\(.*\)$/, "").toLowerCase();
  return !!word && (rule.name || "").toLowerCase().includes(word);
}

/** "Sep 24, 8:30 AM" — today's shares drop the date. */
function shortTime(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const today = new Date().toDateString() === d.toDateString();
  return today ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

const typeLabel = (t) => (t === "*" ? "Anything else" : SHARE_TYPES.find(x => x.id === t)?.label || t || "—");

function SubTabs({ value, onChange, logCount }) {
  const tabs = [["rules", "Rules"], ["log", `Recent shares${logCount ? ` (${logCount})` : ""}`]];
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {tabs.map(([id, label]) => (
        <button key={id} onClick={() => onChange(id)}
          style={{ ...btn, ...(value === id ? primaryBtn : { opacity: 0.7 }) }}>
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
      {/* Row 1 — what the rule is called, and saving it. */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input value={local.name || ""} aria-label="Rule name"
          onChange={e => setLocal(p => ({ ...p, name: e.target.value }))}
          style={{ ...mono, fontSize: 12, fontWeight: 600, flex: "1 1 auto", minWidth: 0, padding: "4px 6px",
            background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border-default)", borderRadius: 4 }} />
        <button style={{ ...btn, ...(dirty ? primaryBtn : { opacity: 0.45 }) }} disabled={!dirty}
          onClick={() => onSave(markUserEdited(local))}><Save size={11} /> {dirty ? "Save" : "Saved"}</button>
        {catchAll ? (
          <span style={small} title="Every grid keeps one catch-all so no share is ever lost (D3). Turn it off instead.">
            always kept
          </span>
        ) : (
          <button style={btn} title="Delete this rule"
            onClick={() => { if (window.confirm(`Delete rule "${local.name}"?`)) onDelete(local.id); }}>
            <Trash2 size={11} />
          </button>
        )}
      </div>

      {/* Row 2 — when it runs, and whether anything runs after it. */}
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", ...small }}>
        <span>Runs for <TypeChip type={shareType} /></span>
        <label style={{ display: "inline-flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={local.enabled !== false}
            onChange={e => setLocal(p => ({ ...p, enabled: e.target.checked }))} /> Enabled
        </label>
        {!catchAll && (
          <label style={{ display: "inline-flex", gap: 4, alignItems: "center", cursor: "pointer" }}
            title="Adds a final step that sets $share.handled, so the catch-all does not ALSO run">
            <input type="checkbox" checked={haltsChain(local.pipeline)}
              onChange={e => setLocal(p => ({ ...p, pipeline: setHaltsChain(p.pipeline, e.target.checked, uid()) }))} />
            Stop here (skip “Anything else”)
          </label>
        )}
      </div>

      <details style={small}>
        <summary style={{ cursor: "pointer" }}>Values this rule can use ({sharePropsFor(shareType).length})</summary>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
          {sharePropsFor(shareType).map(p => (
            <code key={p} style={{ padding: "1px 5px", borderRadius: 3, background: "var(--surface-2, rgba(255,255,255,0.05))",
              color: "var(--text-primary)" }}>{p}</code>
          ))}
        </div>
      </details>

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
    if (!occ) return { label: null, where: null, exists: false };
    const label = occ.label || modulesById?.[occ.moduleId]?.label || null;
    const parentOcc = occ.parentId ? occurrencesById?.[occ.parentId] : null;
    const where = parentOcc
      ? (parentOcc.label || modulesById?.[parentOcc.moduleId]?.label || "a container")
      : (foldersById?.[occ.parentId]?.name ? `${foldersById[occ.parentId].name} folder` : null);
    return { label, where, exists: true };
  };
}

/**
 * Open a created row where you were working (spec §8a: each log row "links to
 * the created occurrence"). The Command Center sits in no panel, so the target
 * is the panel last clicked (helpers/lastPanel), else the grid's first.
 */
function useOpenCreated() {
  const { state, occurrencesById, modulesById, viewsById, dispatch, socket } = useGridActions();
  return (occId) => {
    const panelOccurrence = pickPanelOccurrence({ grid: state?.grid, occurrencesById });
    const res = openOccurrenceInPanel({
      occId, panelOccurrence, occurrencesById, modulesById, viewsById, dispatch, socket,
      onMissing: () => toast("Opened its page — the row is hidden by the page's filter."),
    });
    if (!res.ok) toast("That item isn't on a page (it's filed in a folder), so there's nothing to open.");
  };
}

const STATUS = {
  landed:  { color: "var(--success, #16a34a)", text: "landed" },
  nothing: { color: "var(--warning, #d97706)", text: "nothing written" },
  failed:  { color: "var(--danger, #dc2626)",  text: "failed" },
};

function CreatedLine({ c, whereOf, open, verb }) {
  const { label, where, exists } = whereOf(c.occurrenceId);
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
      <span>{verb || (c.status === "updated" ? "updated" : "created")}</span>
      {exists ? (
        <button onClick={() => open(c.occurrenceId)} title="Open it in the panel you last used"
          style={{ ...mono, fontSize: 11, padding: 0, border: "none", background: "none", cursor: "pointer",
            color: "var(--accent-blue-text, #93c5fd)", textDecoration: "underline", textUnderlineOffset: 2 }}>
          {label || "(untitled)"} <ExternalLink size={9} style={{ display: "inline", verticalAlign: "-1px" }} />
        </button>
      ) : (
        <span style={{ opacity: 0.6 }} title={c.occurrenceId}>(since deleted)</span>
      )}
      {where && <span>in {where}</span>}
    </div>
  );
}

function ShareLog({ entries }) {
  const whereOf = useWhere();
  const open = useOpenCreated();
  if (!entries.length) {
    return <div style={small}>Nothing shared into this grid yet. Clips from the browser extension and shares from your phone or PC appear here.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {entries.map((e, i) => {
        const st = STATUS[e.status] || STATUS.failed;
        const created = (e.rules || []).flatMap(r => r.created || []);
        return (
          <div key={`${e.at}-${i}`} data-testid="share-log-row"
            style={{ borderLeft: `3px solid ${st.color}`, padding: "2px 0 2px 8px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span style={{ ...mono, fontSize: 12, color: "var(--text-primary)", flex: 1, minWidth: 0,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.label || ""}>
                {e.label || "(no name)"}
              </span>
              <span style={{ ...small, whiteSpace: "nowrap" }}>{shortTime(e.at)}</span>
            </div>
            <div style={{ ...small, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <TypeChip type={e.type} />
              <span>from {e.source || "?"}</span>
              <span style={{ color: st.color }}>· {st.text}</span>
            </div>
            <div style={{ ...small, paddingLeft: 4, marginTop: 2 }}>
              {(e.rules || []).map(r => (
                <div key={r.ruleId}>
                  <span style={{ opacity: 0.8 }}><ChevronRight size={9} style={{ display: "inline" }} /> {r.ruleName || "rule"}</span>
                  {!r.ok && <span style={{ color: STATUS.failed.color }}> — {r.error || "error"}</span>}
                  <div style={{ paddingLeft: 12 }}>
                    {(r.created || []).map(c => <CreatedLine key={c.occurrenceId} c={c} whereOf={whereOf} open={open} />)}
                  </div>
                </div>
              ))}
              {/* The shared FILE is saved before any rule runs — say so, or a file share
                  that "added 2 things" reads as a duplicate (user, 2026-09-24). */}
              {e.fileOccurrenceId && !created.some(c => c.occurrenceId === e.fileOccurrenceId) && (
                <CreatedLine c={{ occurrenceId: e.fileOccurrenceId }} whereOf={whereOf} open={open} verb="saved the file" />
              )}
              {(e.notices || []).map(n => (
                <div key={n} style={{ color: STATUS.nothing.color }}>note: {n}</div>
              ))}
              {e.error && <div style={{ color: STATUS.failed.color }}>{e.error}</div>}
            </div>
          </div>
        );
      })}
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
    <label data-testid="share-grid-picker" style={{ ...small, display: "flex", gap: 6, alignItems: "center" }}>
      Shares land in:
      <select value={value ?? ""} disabled={value === undefined} onChange={e => save(e.target.value)}
        style={{ ...btn, padding: "2px 4px" }}>
        <option value="">the grid last opened on that device</option>
        {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      {status && <span style={{ opacity: 0.7 }}>{status}</span>}
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
  // Nothing picked (or the pick was deleted) → the first rule, so the editor
  // is never an empty pane asking you to click something.
  const selected = rules.find(r => r.id === selectedId) || rules[0] || null;
  const free = freeShareTypes(rules);

  const addRule = (shareType) => {
    const op = newShareRule({ id: uid(), gridId, shareType, sortOrder: rules.length });
    CommitHelpers.createOperation({ dispatch, socket, operation: op });
    setSelectedId(op.id);
    setAdding(false);
  };

  return (
    <div data-testid="imports-tab" style={{ padding: 10, ...mono }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", marginBottom: 10, paddingBottom: 8, borderBottom: "1px solid var(--border-subtle, var(--border-default))" }}>
        <SubTabs value={sub} onChange={setSub} logCount={log.length} />
        <ShareGridPicker grids={state?.availableGrids} />
      </div>

      {sub === "log" ? <ShareLog entries={log} /> : (
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "0 0 190px", display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ ...small, marginBottom: 4 }}>Run in this order. A type's own rule runs first; “Anything else” catches the rest.</div>
            {rules.map(r => {
              const on = r.id === selected?.id;
              return (
                <button key={r.id} onClick={() => setSelectedId(r.id)} data-testid="share-rule-row"
                  style={{ ...btn, ...(on ? primaryBtn : {}), textAlign: "left", display: "flex", gap: 6,
                    alignItems: "center", opacity: r.enabled === false ? 0.5 : 1 }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                  {r.enabled === false
                    ? <span style={{ ...small, fontSize: 9 }}>off</span>
                    : !namesItsType(r) && <TypeChip type={shareTriggerOf(r)?.shareType} />}
                </button>
              );
            })}
            {!rules.length && <div style={small}><Inbox size={12} /> No rules yet — the first share creates “Anything else”.</div>}
            {adding ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
                <div style={small}>Add a rule for:</div>
                {free.map(t => <button key={t.id} style={{ ...btn, textAlign: "left" }} onClick={() => addRule(t.id)}>{t.label}</button>)}
                <button style={{ ...btn, opacity: 0.7 }} onClick={() => setAdding(false)}>cancel</button>
              </div>
            ) : free.length > 0 && (
              <button style={{ ...btn, marginTop: 4, opacity: 0.85 }} onClick={() => setAdding(true)}><Plus size={11} /> Add rule</button>
            )}
          </div>
          <div style={{ flex: "1 1 400px", minWidth: 0 }}>
            {selected ? (
              <RuleEditor rule={selected} fields={fields}
                onSave={(op) => CommitHelpers.updateOperation({ dispatch, socket, operation: op })}
                onDelete={(id) => { CommitHelpers.deleteOperation({ dispatch, socket, operationId: id }); setSelectedId(null); }} />
            ) : (
              <div style={small}>Add a rule to decide where a type of share goes.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
