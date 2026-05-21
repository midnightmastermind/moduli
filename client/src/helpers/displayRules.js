// helpers/displayRules.js
//
// Rule evaluator for operation-driven display fields. An operation can
// stash a `$displayRules` object in its $vars (keyed by occurrence
// label). When the pipeline writes a computed value for a display
// field, the executor calls `applyDisplayRules` to look up the rules
// for that occurrence's label, evaluate the first-matching `when`
// clause, and attach the rule's outputs (color / icon / suffix /
// replaceValue) onto the computed-value update.
//
// Predicate language: each rule's `when` is an object whose keys are
// short named accessors (no `$chain` syntax — designed to be readable
// when the author hand-edits the array in the structured editor).
//   - "value"   → the value being written
//   - "target"  → "met" | "notMet" | "none"
//   - <other>   → matched against any sibling field on the occurrence
//                 by short field name (case-insensitive)
//
// Each accessor's expected value is either:
//   - a keyword string ("negative" | "zero" | "positive" | "null" |
//     "met" | "notMet" | "none" | "filled" | "empty")
//   - a literal scalar (equality match)
//   - a comparator object `{ comp: "LT|LTE|GT|GTE|EQ|NEQ|CONTAINS", right }`
//
// Multiple keys inside one `when` are AND-ed. Rules are evaluated in
// array order; first match wins. Rule body extra keys (color/icon/...)
// are passed through verbatim.

const KEYWORDS = new Set([
  "negative", "zero", "positive", "null",
  "met", "notMet", "none",
  "filled", "empty",
]);

function targetState({ value, target }) {
  if (target == null) return "none";
  if (typeof target === "object" && "value" in target) {
    const t = target.value;
    if (typeof t !== "number" || typeof value !== "number") return "none";
    return value >= t ? "met" : "notMet";
  }
  if (typeof target === "string") return target;
  return "none";
}

function buildFieldsByName(occurrence, fieldsById) {
  const out = Object.create(null);
  if (!occurrence?.fields || !fieldsById) return out;
  for (const fid of Object.keys(occurrence.fields)) {
    const def = fieldsById[fid];
    if (!def?.name) continue;
    out[def.name] = { fieldId: fid, name: def.name };
    out[String(def.name).toLowerCase()] = out[def.name];
  }
  return out;
}

function resolveAccessor(key, ctx) {
  if (key === "value")  return ctx.value;
  if (key === "target") return targetState(ctx);
  const f = ctx.fieldsByName?.[key] || ctx.fieldsByName?.[String(key).toLowerCase()];
  if (!f) return undefined;
  const raw = ctx.occurrence?.fields?.[f.fieldId];
  if (raw == null) return undefined;
  return (raw && typeof raw === "object" && "value" in raw) ? raw.value : raw;
}

function compareKeyword(actual, keyword) {
  switch (keyword) {
    case "negative": return typeof actual === "number" && actual < 0;
    case "zero":     return actual === 0;
    case "positive": return typeof actual === "number" && actual > 0;
    case "null":     return actual == null;
    case "met":      return actual === "met";
    case "notMet":   return actual === "notMet";
    case "none":     return actual === "none" || actual == null;
    case "filled":   return actual != null && actual !== "" && actual !== false;
    case "empty":    return actual == null || actual === "" || actual === false;
    default:         return false;
  }
}

function evalComparator(left, comp, right) {
  switch (comp) {
    case "EQ":  return left === right;
    case "NEQ": return left !== right;
    case "LT":  return left <  right;
    case "LTE": return left <= right;
    case "GT":  return left >  right;
    case "GTE": return left >= right;
    case "CONTAINS":
      if (Array.isArray(left)) return left.includes(right);
      return String(left ?? "").includes(String(right));
    default: return false;
  }
}

function matchExpected(actual, expected, ctx) {
  if (typeof expected === "string" && KEYWORDS.has(expected)) {
    return compareKeyword(actual, expected);
  }
  if (expected && typeof expected === "object" && !Array.isArray(expected) && typeof expected.comp === "string") {
    return evalComparator(actual, expected.comp, expected.right);
  }
  return actual === expected;
}

export function matchWhen(when, ctx) {
  if (!when || typeof when !== "object") return false;
  for (const key of Object.keys(when)) {
    if (!matchExpected(resolveAccessor(key, ctx), when[key], ctx)) return false;
  }
  return true;
}

// Pick the first matching rule from an array. Returns the rule's body
// (everything except `when`) or null if no match. Body shape is
// open-ended — callers read color / icon / suffix / replaceValue but
// any additional keys round-trip too.
export function pickRule({ rules, value, target, occurrence, fieldsByName }) {
  if (!Array.isArray(rules)) return null;
  const ctx = { value, target, occurrence, fieldsByName };
  for (const rule of rules) {
    if (!rule || typeof rule !== "object") continue;
    if (matchWhen(rule.when, ctx)) {
      const { when: _w, ...body } = rule;
      return body;
    }
  }
  return null;
}

// Look up the rules entry for an occurrence by label and evaluate.
// Returns the matched rule body, or null when no rules / no match.
export function applyDisplayRules({ displayRules, value, target, occurrence, fieldsById }) {
  if (!displayRules || typeof displayRules !== "object" || !occurrence) return null;
  const label = occurrence.label;
  if (!label) return null;
  const rules = displayRules[label];
  if (!Array.isArray(rules) || rules.length === 0) return null;
  const fieldsByName = buildFieldsByName(occurrence, fieldsById);
  return pickRule({ rules, value, target, occurrence, fieldsByName });
}
