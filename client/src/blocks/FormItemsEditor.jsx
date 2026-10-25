// blocks/FormItemsEditor.jsx — the form builder: the editor of an "Ask with a form" (ASK_FORM) step's inputs.
//
// Two kinds of input: a FIELD input (picked from the grid's fields; the window shows that field's own control and
// the answer lands in $form.fields.<field id>, ready for a Create step) and a QUESTION (a plain input of a chosen
// type; the answer lands in $form.values.<key>). Each has a label, help text, required and a default (an
// expression, e.g. a field of $trigger.occurrence). A key is set once from the first label and never follows a
// rename, so the steps that read $form.values.<key> keep working. "Preview" opens the real form window.
import React, { useMemo, useState } from "react";
import { ChevronUp, ChevronDown, X } from "lucide-react";
import FieldSelect from "../ui/FieldSelect.jsx";
import FormModal from "../ui/FormModal.jsx";
import { itemKey } from "../helpers/formItems.js";

const QUESTION_TYPES = [
  ["text", "text"], ["longtext", "long text"], ["number", "number"],
  ["boolean", "yes / no"], ["date", "date"], ["select", "choice"],
];

const rowSt = {
  display: "flex", flexDirection: "column", gap: 4, padding: 6,
  border: "1px solid var(--border-subtle)", borderRadius: 4, background: "var(--input-bg)",
};
const inSt = {
  fontSize: 11, padding: "2px 6px", background: "var(--surface-card)", color: "var(--text-primary)",
  border: "1px solid var(--input-border)", borderRadius: 3, minWidth: 0,
};
const btnSt = {
  fontSize: 11, padding: "2px 8px", background: "transparent", color: "var(--text-muted)",
  border: "1px solid var(--border-default)", borderRadius: 3, cursor: "pointer",
};
const iconBtnSt = { ...btnSt, padding: "1px 3px", display: "inline-flex", alignItems: "center" };

/** The choices of a "choice" question, edited as one comma-separated line. */
function ChoicesInput({ options, onChange }) {
  const text = (options || []).map((o) => (typeof o === "string" ? o : o.label || o.value)).join(", ");
  const [draft, setDraft] = useState(text);
  return (
    <input aria-label="Choices" style={{ ...inSt, flex: 1 }} value={draft} placeholder="Choices, comma separated"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onChange(draft.split(",").map((s) => s.trim()).filter(Boolean).map((s) => ({ value: s, label: s })))} />
  );
}

export default function FormItemsEditor({ value, onChange, fieldsById = {}, renderExpr = null }) {
  const items = Array.isArray(value) ? value : [];
  const [previewing, setPreviewing] = useState(false);
  const fields = useMemo(
    () => Object.values(fieldsById || {}).filter((f) => f && !f.trashed && f.type !== "button"),
    [fieldsById],
  );

  const keys = items.map((i) => i.key);
  const patch = (idx, p) => onChange(items.map((it, i) => (i === idx ? { ...it, ...p } : it)));
  const drop = (obj, k) => { const { [k]: _gone, ...rest } = obj; return rest; };

  const addField = (fieldId) => {
    const f = fieldsById[fieldId];
    if (!f) return;
    onChange([...items, { key: itemKey(f.name, keys), label: f.name, fieldId }]);
  };
  const addQuestion = () => onChange([...items, { key: itemKey("Question", keys), label: "Question", type: "text" }]);
  const move = (idx, dir) => {
    const to = idx + dir;
    if (to < 0 || to >= items.length) return;
    const next = items.slice();
    [next[idx], next[to]] = [next[to], next[idx]];
    onChange(next);
  };

  // The window shows a default as the expression it is — it is resolved only when the operation runs.
  const preview = useMemo(() => ({
    form: true, title: "Preview", submitLabel: "Close",
    items: items.map((it) => ({ ...it, ...(it.fieldId ? { field: fieldsById[it.fieldId] } : {}) }))
      .filter((it) => !it.fieldId || it.field),
  }), [items, fieldsById]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 260 }} data-testid="form-items-editor">
      {items.map((it, idx) => {
        const field = it.fieldId ? fieldsById[it.fieldId] : null;
        return (
          <div key={it.key} style={rowSt}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input aria-label="Label" style={{ ...inSt, flex: 1 }} value={it.label || ""}
                onChange={(e) => patch(idx, { label: e.target.value })} />
              {it.fieldId ? (
                <span style={{ fontSize: 10, color: field ? "var(--text-muted)" : "var(--danger-text)" }}
                  title={`Answer: $form.fields.${it.fieldId}`}>
                  {field ? `field · ${field.type}` : "field removed"}
                </span>
              ) : (
                <select aria-label="Type" style={inSt} value={it.type || "text"}
                  onChange={(e) => patch(idx, e.target.value === "select" ? { type: "select" } : drop({ ...it, type: e.target.value }, "options"))}>
                  {QUESTION_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              )}
              <label style={{ fontSize: 10, color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: 2 }}>
                <input type="checkbox" aria-label="Required" checked={!!it.required}
                  onChange={(e) => onChange(items.map((x, i) => (i !== idx ? x : e.target.checked ? { ...x, required: true } : drop(x, "required"))))} />
                required
              </label>
              <button type="button" aria-label="Move up" style={iconBtnSt} disabled={idx === 0} onClick={() => move(idx, -1)}><ChevronUp size={11} /></button>
              <button type="button" aria-label="Move down" style={iconBtnSt} disabled={idx === items.length - 1} onClick={() => move(idx, 1)}><ChevronDown size={11} /></button>
              <button type="button" aria-label="Remove input" style={iconBtnSt} onClick={() => onChange(items.filter((_, i) => i !== idx))}><X size={11} /></button>
            </div>
            {!it.fieldId && it.type === "select" && (
              <ChoicesInput options={it.options} onChange={(options) => patch(idx, { options })} />
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-muted)" }}>
              default
              {renderExpr
                ? renderExpr(it.default ?? "", (v) => onChange(items.map((x, i) => (i !== idx ? x : v === "" || v == null ? drop(x, "default") : { ...x, default: v }))))
                : <input aria-label="Default" style={{ ...inSt, flex: 1 }} value={it.default ?? ""} placeholder="(none)"
                    onChange={(e) => onChange(items.map((x, i) => (i !== idx ? x : e.target.value === "" ? drop(x, "default") : { ...x, default: e.target.value })))} />}
              <input aria-label="Help" style={{ ...inSt, flex: 1 }} value={it.help || ""} placeholder="help text"
                onChange={(e) => onChange(items.map((x, i) => (i !== idx ? x : e.target.value === "" ? drop(x, "help") : { ...x, help: e.target.value })))} />
            </div>
            <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
              answer: {it.fieldId ? `$form.fields.${field?.name || it.fieldId}` : `$form.values.${it.key}`}
            </div>
          </div>
        );
      })}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ minWidth: 150 }}>
          <FieldSelect fields={fields} value={null} onChange={addField} placeholder="+ Field input" ariaLabel="Add a field input" />
        </span>
        <button type="button" style={btnSt} onClick={addQuestion}>+ Question</button>
        <button type="button" style={btnSt} disabled={items.length === 0} onClick={() => setPreviewing(true)}>Preview</button>
      </div>
      {previewing && (
        <FormModal request={preview} onSubmit={() => setPreviewing(false)} onCancel={() => setPreviewing(false)} />
      )}
    </div>
  );
}
