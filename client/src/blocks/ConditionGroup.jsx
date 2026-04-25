// blocks/ConditionGroup.jsx
// Recursive condition builder supporting nested AND/OR groups.
import React, { useMemo } from "react";
import SelectDrilldown, { buildPathConfig, chainToPathString, pathStringToChain } from "../ui/SelectDrilldown";

const COMPARATORS = [
  "IS", "IS_NOT", "GREATER", "LESS", "GREATER_OR_EQUAL", "LESS_OR_EQUAL",
  "CONTAINS", "NOT_CONTAINS", "IS_EMPTY", "IS_NOT_EMPTY",
  "HAS_ANCESTOR",
  "SAME_DAY", "SAME_WEEK", "SAME_MONTH", "SAME_YEAR",
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
// Dashed-purple variant for "+ Group" — visually separates "add rule at this level"
// from "add nested AND/OR group at this level".
const addGroupBtnStyle = {
  ...addBtnStyle,
  border: "1px dashed rgba(167,139,250,0.5)",
  color: "rgba(167,139,250,0.7)",
};
const removeBtnSt = {
  fontSize: 10, color: "rgba(255,100,100,0.5)",
  background: "none", border: "none", cursor: "pointer", padding: "0 2px", lineHeight: 1,
};
const rowStyle = {
  display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap",
  background: "var(--border-subtle)", borderRadius: 4, padding: "4px 6px",
};

export default function ConditionGroup({ group, onChange, sources, fields, fieldsById, modulesById, occurrencesById, depth = 0 }) {
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

  const pathConfig = buildPathConfig({ sources, fields, inLoop: true, fieldsById, modulesById, occurrencesById });

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
        <button onClick={addGroup} style={addGroupBtnStyle}>+ Group</button>
      </div>
      {rules.map((entry, i) => (
        <div key={i} style={{ marginBottom: 4 }}>
          {Array.isArray(entry.rules) ? (
            <div style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
              <ConditionGroup group={entry} onChange={(next) => setRule(i, next)} sources={sources} fields={fields} fieldsById={fieldsById} modulesById={modulesById} occurrencesById={occurrencesById} depth={depth + 1} />
              <button onClick={() => removeRule(i)} style={removeBtnSt}>×</button>
            </div>
          ) : (
            <RuleRow
              rule={entry}
              onChange={(next) => setRule(i, next)}
              onRemove={() => removeRule(i)}
              pathConfig={pathConfig}
              sources={sources}
              fields={fields}
              fieldsById={fieldsById}
              modulesById={modulesById}
              occurrencesById={occurrencesById}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function RuleRow({ rule, onChange, onRemove, pathConfig, sources, fields, fieldsById, modulesById, occurrencesById }) {
  const rightConfig = useMemo(
    () => buildPathConfig({ sources, fields, inLoop: true, fieldsById, modulesById, occurrencesById }),
    [sources, fields, fieldsById, modulesById, occurrencesById],
  );
  const v = (rule.right ?? "").toString().trim();
  const initialMode = (!v || (v.startsWith("$") && !v.startsWith("literal:"))) ? "path" : "text";
  const [rightMode, setRightMode] = React.useState(initialMode);
  const toggleRightMode = () => setRightMode(m => (m === "path" ? "text" : "path"));
  return (
    <div style={rowStyle}>
      <SelectDrilldown
        config={pathConfig}
        value={rule.left ? [pathStringToChain(rule.left)] : []}
        onChange={chains => onChange({ ...rule, left: chains.length > 0 ? chainToPathString(chains[chains.length - 1]) : "" })}
      />
      <select value={rule.comparator} onChange={(e) => onChange({ ...rule, comparator: e.target.value })} style={selectSt}>
        {COMPARATORS.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <button
        onClick={toggleRightMode}
        title="Toggle path picker / free text"
        style={{ fontSize: 9, padding: "1px 4px", border: "1px solid var(--input-border)", borderRadius: 3, background: "var(--surface)", color: "var(--text-muted)", cursor: "pointer" }}
      >
        {rightMode === "path" ? "path" : "text"}
      </button>
      {rightMode === "path" ? (
        <SelectDrilldown
          config={rightConfig}
          value={rule.right ? [pathStringToChain(String(rule.right))] : []}
          onChange={chains => onChange({ ...rule, right: chains.length > 0 ? chainToPathString(chains[chains.length - 1]) : "" })}
        />
      ) : (
        <input
          type="text"
          value={rule.right ?? ""}
          onChange={(e) => onChange({ ...rule, right: e.target.value })}
          placeholder="value or $var"
          style={{ ...inputSt, width: 140 }}
        />
      )}
      <button onClick={onRemove} style={removeBtnSt}>×</button>
    </div>
  );
}
