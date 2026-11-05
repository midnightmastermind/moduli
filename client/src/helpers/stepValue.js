// helpers/stepValue.js — a PLAIN value in an operation step, as the expression the executor reads.
//
// A step's value box is an expression. "value" mode (blocks/StepValueField) draws the field's own control over it, so
// an occurrence field does not mean pasting an id no screen shows. What it writes must read back as exactly what was
// picked: `literal:` turns "true" and "7" into a boolean and a number, so a text field's "007" goes as `json:"007"`.
const NUMERIC = /^-?\d+(\.\d+)?$/;
const NUMERIC_TYPES = new Set(["number", "duration", "rating"]);
const coercedByLiteral = (s) => s === "true" || s === "false" || s === "null" || NUMERIC.test(s);

export function encodeStepValue(v, field = null) {
  if (v == null || v === "") return "";
  if (typeof v === "object") return `json:${JSON.stringify(v)}`;
  if (typeof v !== "string") return `literal:${v}`;
  if (coercedByLiteral(v) && !(NUMERIC_TYPES.has(field?.type) && NUMERIC.test(v))) return `json:${JSON.stringify(v)}`;
  return `literal:${v}`;
}

/** The plain value an expression holds; `undefined` when it is not one (see isPlainStepValue). */
export function decodeStepValue(expr) {
  if (expr == null || expr === "") return null;
  if (typeof expr !== "string") return expr;
  if (expr.startsWith("literal:")) {
    const raw = expr.slice(8);
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (raw === "null") return null;
    return NUMERIC.test(raw) ? Number(raw) : raw;
  }
  if (expr.startsWith("json:")) { try { return JSON.parse(expr.slice(5)); } catch { return undefined; } }
  return undefined;
}

/** A value "value" mode can show: nothing yet, a literal, or JSON with no `$variable` inside. A path stays an expression. */
export function isPlainStepValue(expr) {
  if (expr == null || expr === "") return true;
  if (typeof expr !== "string") return true;
  if (expr.startsWith("literal:")) return true;
  if (expr.startsWith("json:")) { if (expr.includes('"$')) return false; return decodeStepValue(expr) !== undefined; }
  return false;
}
