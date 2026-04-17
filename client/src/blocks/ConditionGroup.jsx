// blocks/ConditionGroup.jsx
// Recursive condition builder supporting nested AND/OR groups.
// Each entry in `rules` is either a leaf rule or another group.
import React from "react";
import PathPicker, { buildPathShape } from "./PathPicker";

const COMPARATORS = [
  "IS", "IS_NOT", "GREATER", "LESS", "GREATER_OR_EQUAL", "LESS_OR_EQUAL",
  "CONTAINS", "NOT_CONTAINS", "IS_EMPTY", "IS_NOT_EMPTY",
  "HAS_ANCESTOR", "DATE_IS_TODAY", "DATE_BEFORE_TODAY", "DATE_AFTER_TODAY",
];

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
    <div style={{ border: "1px solid var(--border)", borderRadius: 4, padding: 6, marginLeft: depth * 12, background: depth % 2 ? "var(--surface-2)" : "var(--surface)" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
        <select value={operator} onChange={(e) => setOperator(e.target.value)}>
          <option value="AND">ALL of</option>
          <option value="OR">ANY of</option>
        </select>
        <button onClick={addRule}>+ Rule</button>
        <button onClick={addGroup}>+ Group</button>
      </div>
      {rules.map((entry, i) => (
        <div key={i} style={{ marginBottom: 4 }}>
          {Array.isArray(entry.rules) ? (
            <div style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
              <ConditionGroup group={entry} onChange={(next) => setRule(i, next)} sources={sources} fields={fields} depth={depth + 1} />
              <button onClick={() => removeRule(i)}>×</button>
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
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <PathPicker value={rule.left} onChange={(next) => onChange({ ...rule, left: next })} shapeByVar={shape} />
      <select value={rule.comparator} onChange={(e) => onChange({ ...rule, comparator: e.target.value })}>
        {COMPARATORS.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <input
        type="text"
        value={rule.right ?? ""}
        onChange={(e) => onChange({ ...rule, right: e.target.value })}
        placeholder="value or $var"
        style={{ width: 140 }}
      />
      <button onClick={onRemove}>×</button>
    </div>
  );
}
