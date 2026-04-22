// blocks/ConditionGroup.jsx
// Recursive condition builder supporting nested AND/OR groups.
import React from "react";
import PathPicker, { buildPathShape } from "./PathPicker";

const COMPARATORS = [
  "IS", "IS_NOT", "GREATER", "LESS", "GREATER_OR_EQUAL", "LESS_OR_EQUAL",
  "CONTAINS", "NOT_CONTAINS", "IS_EMPTY", "IS_NOT_EMPTY",
  "HAS_ANCESTOR",
  "DATE_EQUALS", "DATE_IS_TODAY", "DATE_BEFORE_TODAY", "DATE_AFTER_TODAY",
];

const selectSt = {
  fontSize: 10, fontFamily: "monospace", padding: "2px 4px", borderRadius: 4,
  background: "var(--input-bg)", border: "1px solid var(--input-border)",
  color: "var(--text-primary)",
};
const inputSt = {
  fontSize: 10, fontFamily: "monospace", padding: "2px 5px", borderRadius: 4,
  background: "var(--input-bg)", border: "1px solid var(--input-border)",
  color: "var(--text-primary)", outline: "none", minWidth: 60,
};
const addBtnStyle = {
  display: "inline-flex", alignItems: "center", gap: 4,
  padding: "2px 8px", borderRadius: 4, fontSize: 10, fontFamily: "monospace",
  background: "var(--input-bg)", border: "1px dashed var(--border-default)",
  color: "var(--text-muted)", cursor: "pointer",
};
const removeBtnSt = {
  fontSize: 10, color: "rgba(255,100,100,0.5)",
  background: "none", border: "none", cursor: "pointer", padding: "0 2px", lineHeight: 1,
};
const rowStyle = {
  display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap",
  background: "var(--border-subtle)", borderRadius: 4, padding: "4px 6px",
};

export default function ConditionGroup({ group, onChange, sources, fields, depth = 0 }) {
  const { operator = "AND", rules = [] } = group;

  const setOperator = (op) => onChange({ ...group, operator: op });
  const setRule = (idx, next) => {
    const copy = rules.slice();
    copy[idx] = next;
    onChange({ ...group, rules: copy });
  };
  const removeRule = (idx) => {
    const copy = rules.slice();
    copy.splice(idx, 1);
    onChange({ ...group, rules: copy });
  };
  const addRule = () => onChange({ ...group, rules: [...rules, { left: "", comparator: "IS", right: "" }] });
  const addGroup = () => onChange({ ...group, rules: [...rules, { operator: "AND", rules: [] }] });

  const shape = buildPathShape({ sources, fields, inLoop: true });

  return (
    <div style={{
      border: "1px solid var(--border-default)", borderRadius: 4, padding: 6,
      marginLeft: depth * 12,
      background: depth % 2 ? "var(--border-subtle)" : "var(--input-bg)",
    }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
        <select value={operator} onChange={(e) => setOperator(e.target.value)} style={selectSt}>
          <option value="AND">ALL of</option>
          <option value="OR">ANY of</option>
        </select>
        <button onClick={addRule} style={addBtnStyle}>+ Rule</button>
        <button onClick={addGroup} style={addBtnStyle}>+ Group</button>
      </div>
      {rules.map((entry, i) => (
        <div key={i} style={{ marginBottom: 4 }}>
          {Array.isArray(entry.rules) ? (
            <div style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
              <ConditionGroup group={entry} onChange={(next) => setRule(i, next)} sources={sources} fields={fields} depth={depth + 1} />
              <button onClick={() => removeRule(i)} style={removeBtnSt}>×</button>
            </div>
          ) : (
            <RuleRow rule={entry} onChange={(next) => setRule(i, next)} onRemove={() => removeRule(i)} shape={shape} />
          )}
        </div>
      ))}
    </div>
  );
}

function RuleRow({ rule, onChange, onRemove, shape }) {
  return (
    <div style={rowStyle}>
      <PathPicker value={rule.left} onChange={(next) => onChange({ ...rule, left: next })} shapeByVar={shape} />
      <select value={rule.comparator} onChange={(e) => onChange({ ...rule, comparator: e.target.value })} style={selectSt}>
        {COMPARATORS.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <input
        type="text"
        value={rule.right ?? ""}
        onChange={(e) => onChange({ ...rule, right: e.target.value })}
        placeholder="value or $var"
        style={{ ...inputSt, width: 140 }}
      />
      <button onClick={onRemove} style={removeBtnSt}>×</button>
    </div>
  );
}
