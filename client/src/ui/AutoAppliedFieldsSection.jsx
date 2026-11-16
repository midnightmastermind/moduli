// ui/AutoAppliedFieldsSection.jsx — "Every item here gets": the fields every occurrence at or under this page /
// container has, whether or not its module binds them (user, 2026-11-16: "all tasks should have a completed field,
// thats a must for the tasks container … a setting that gives them all the completed field").
//
// It edits `occurrence.autoAppliedFieldIds`, the per-occurrence level of the cascade
// `state/selectors.getEffectiveAutoAppliedFieldIds` already resolves (grid meta.autoAppliedFieldIds is the root).
// That cascade is NEAREST-WINS — a level's list REPLACES what it inherits — so an edit starts from the inherited list:
// adding Completed under a grid that applies Tags and Date writes [Tags, Date, Completed], never [Completed] alone
// (which would silently take Tags and Date off every task). "Inherit" clears the level.
import React, { useMemo } from "react";
import { useGridActions } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { getEffectiveAutoAppliedFieldIds, getParentOccurrence } from "../state/selectors";
import { cachedParentMap } from "../helpers/dragHitTesting";
import FieldSelect from "./FieldSelect.jsx";
import { MENU_CAPTION } from "./menuText";

/** The list to write after an edit. Pure. `own` null = inheriting; returns null to go back to inheriting. */
export function nextAutoApplied({ own, inherited, add = null, remove = null, reset = false }) {
  if (reset) return null;
  const base = Array.isArray(own) ? own : (Array.isArray(inherited) ? inherited : []);
  let next = base;
  if (add && !next.includes(add)) next = [...next, add];
  if (remove) next = next.filter((id) => id !== remove);
  return next;
}

export default function AutoAppliedFieldsSection({ occurrence }) {
  const { dispatch, socket, fieldsById, occurrencesById, state } = useGridActions();
  const grid = state?.grid || null;
  const own = Array.isArray(occurrence?.autoAppliedFieldIds) ? occurrence.autoAppliedFieldIds : null;
  const parentByChildId = useMemo(() => cachedParentMap(occurrencesById || {}), [occurrencesById]);
  const inherited = useMemo(() => {
    const parent = getParentOccurrence(occurrence, { occurrencesById, parentByChildId });
    return getEffectiveAutoAppliedFieldIds(parent || null, { occurrencesById, parentByChildId, grid });
  }, [occurrence, occurrencesById, parentByChildId, grid]);
  const effective = own ?? inherited;
  const name = (id) => fieldsById?.[id]?.name || id;
  const write = (next) => {
    if (!occurrence?.id) return;
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: occurrence.id, autoAppliedFieldIds: next }, emit: true });
  };
  const caption = { ...MENU_CAPTION, letterSpacing: "0.06em", marginTop: 8, marginBottom: 4 };
  return (
    <section data-testid="auto-applied" style={{ marginBottom: 8, borderTop: "1px solid var(--panel-border, #374151)", paddingTop: 8 }}>
      <div style={caption}>Every item here gets</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
        {effective.map((fid) => (
          <span key={fid} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, padding: "1px 6px", borderRadius: 10,
            border: "1px solid var(--input-border, #374151)", opacity: own ? 1 : 0.7 }}>
            {name(fid)}
            <button type="button" title={`Stop giving every item ${name(fid)}`} aria-label={`Remove ${name(fid)}`}
              onClick={() => write(nextAutoApplied({ own, inherited, remove: fid }))}
              style={{ background: "transparent", border: 0, padding: 0, cursor: "pointer", color: "var(--text-muted, #888)" }}>×</button>
          </span>
        ))}
        <div style={{ minWidth: 140 }}>
          <FieldSelect fields={Object.values(fieldsById || {}).filter((f) => !effective.includes(f.id))} value={null}
            placeholder="+ field" onChange={(fid) => fid && write(nextAutoApplied({ own, inherited, add: fid }))} />
        </div>
      </div>
      <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
        {own ? <>Set here · <button type="button" onClick={() => write(nextAutoApplied({ reset: true }))}
          style={{ background: "transparent", border: 0, padding: 0, cursor: "pointer", color: "var(--accent-blue, #60a5fa)", fontSize: 12 }}>inherit instead</button></>
          : "Inherited from above"}
      </div>
    </section>
  );
}
