// services/serverExecutor.js
//
// Headless executor for /api/v1/operations/:id/run when no browser tab
// is connected. Handles the subset of action types needed for typical
// CALL_API / integration ops:
//
//   INIT_VAR / SET_VAR — set a $var from an expression
//   IF + AND/OR/NOT predicates with basic comparators
//   LOOP over an array $var (as / overExpr)
//   CALL_API — outbound HTTP (the headliner)
//   SHOW_VALUE — stage a named result for the caller
//
// The full client-side executor handles dozens more action types
// (FIND / CREATE / COPY_LINK / APPLY_TEMPLATE / aggregations / etc.)
// — anything beyond the subset above needs a connected browser tab
// today. Phase 4+ work will either port the full executor server-side
// or refactor the client one into a shared isomorphic module.
//
// Per docs/api-plan.md §2.

import Secret from "../models/Secret.js";

const SCALAR_LITERAL_RE = /^literal:/;
const NUMBER_LITERAL_RE = /^-?\d+(\.\d+)?$/;

function isObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }

// Resolve `expr` against $vars. Mirrors the client `resolveExpr` for the
// subset of forms this executor needs:
//   - "literal:foo"   → "foo"
//   - "json:[...]"    → JSON.parse([...])
//   - "$var"          → $vars["$var"]
//   - "$var.a.b"      → walk $vars["$var"].a.b
//   - "$secrets.KEY"  → resolveSecret(KEY) — async, see resolveExprAsync
//   - "123" / "3.14"  → Number
//   - "true"/"false"/"null" → respective literals
//   - any other string → returned as-is
//   - non-string      → returned as-is
function resolveExpr(expr, $vars) {
  if (typeof expr !== "string") return expr;
  if (SCALAR_LITERAL_RE.test(expr)) return expr.replace(SCALAR_LITERAL_RE, "");
  if (expr.startsWith("json:")) {
    try { return JSON.parse(expr.slice(5)); } catch { return null; }
  }
  if (expr === "true") return true;
  if (expr === "false") return false;
  if (expr === "null") return null;
  if (NUMBER_LITERAL_RE.test(expr)) return Number(expr);
  if (expr.startsWith("$")) {
    const dot = expr.indexOf(".");
    const head = dot < 0 ? expr : expr.slice(0, dot);
    const path = dot < 0 ? [] : expr.slice(dot + 1).split(".");
    let cur = $vars[head];
    for (const seg of path) {
      if (cur == null) return null;
      cur = cur[seg];
    }
    return cur;
  }
  // Template interpolation: "literal ${$foo} text"
  if (expr.includes("${")) {
    return expr.replace(/\$\{([^}]+)\}/g, (_, inner) => {
      const v = resolveExpr(inner.startsWith("$") ? inner : `$${inner}`, $vars);
      return v == null ? "" : String(v);
    });
  }
  return expr;
}

// Async wrapper for resolveExpr that also handles "$secrets.KEY". Secrets
// only resolve server-side (CALL_API headers, etc.) so anything that runs
// through deepResolveExprAsync gets the lookup.
async function resolveExprAsync(expr, $vars, { userId } = {}) {
  if (typeof expr !== "string") return expr;
  if (expr.startsWith("$secrets.") && userId) {
    const key = expr.slice("$secrets.".length).split(".")[0];
    const doc = await Secret.findOne({ userId, key });
    if (!doc) return null;
    try { return Secret.decryptValue(doc); } catch { return null; }
  }
  return resolveExpr(expr, $vars);
}

async function deepResolveExprAsync(value, $vars, opts) {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return Promise.all(value.map(v => deepResolveExprAsync(v, $vars, opts)));
  }
  if (isObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = await deepResolveExprAsync(v, $vars, opts);
    }
    return out;
  }
  return resolveExprAsync(value, $vars, opts);
}

// Minimal predicate eval: AND/OR with rules { left, comparator, right }.
// Supports a subset of comparators — enough for typical guards.
function evalGroup(group, $vars) {
  if (!group) return true;
  const op = (group.operator || "AND").toUpperCase();
  const rules = group.rules || [];
  const evaluated = rules.map(r => {
    if (r.operator) return evalGroup(r, $vars);
    return evalRule(r, $vars);
  });
  if (op === "OR") return evaluated.some(Boolean);
  if (op === "NOT") return !evaluated.every(Boolean);
  return evaluated.every(Boolean);
}

function evalRule(rule, $vars) {
  const left = resolveExpr(rule.left, $vars);
  const right = resolveExpr(rule.right, $vars);
  switch (rule.comparator) {
    case "IS":             return left == right; // eslint-disable-line eqeqeq
    case "IS_NOT":         return left != right; // eslint-disable-line eqeqeq
    case "IS_EMPTY":       return left === null || left === undefined || left === "" || (Array.isArray(left) && left.length === 0);
    case "IS_NOT_EMPTY":   return !(left === null || left === undefined || left === "" || (Array.isArray(left) && left.length === 0));
    case "GREATER":        return Number(left) > Number(right);
    case "GREATER_OR_EQUAL": return Number(left) >= Number(right);
    case "LESS":           return Number(left) < Number(right);
    case "LESS_OR_EQUAL":  return Number(left) <= Number(right);
    case "CONTAINS":       return typeof left === "string" && left.includes(String(right));
    case "ARRAY_INCLUDES": return Array.isArray(left) && left.includes(right);
    default:               return left == right; // eslint-disable-line eqeqeq
  }
}

// Append a query string to a URL (preserves existing one).
function appendQuery(url, query) {
  const parts = Object.entries(query || {})
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(typeof v === "object" ? JSON.stringify(v) : String(v))}`);
  if (!parts.length) return String(url);
  const qs = parts.join("&");
  return String(url) + (String(url).includes("?") ? "&" : "?") + qs;
}

/**
 * Run an operation server-side. Returns { ok, vars, effects, durationMs }
 * matching the shape /api/v1/operations/:id/run already returns from the
 * client bridge.
 *
 * Caller supplies vars (folded into $vars under "$name" keys) plus
 * userId for secrets lookup.
 */
export async function runOperationServerSide(op, { vars = {}, userId } = {}) {
  const startedAt = Date.now();
  const $vars = {};
  // Fold caller vars (both "$foo" and "foo" forms).
  for (const [k, v] of Object.entries(vars || {})) {
    $vars[k.startsWith("$") ? k : `$${k}`] = v;
  }

  const effects = [];
  const opts = { userId };

  async function executeStep(step) {
    const cfg = step?.config || {};
    const type = cfg.type;

    if (type === "INIT_VAR" || type === "SET_VAR") {
      $vars[cfg.name] = await resolveExprAsync(cfg.expr ?? cfg.value, $vars, opts);
      return;
    }
    if (type === "SHOW_VALUE") {
      const name = String(cfg.name || "$result").startsWith("$") ? cfg.name : `$${cfg.name}`;
      const value = await resolveExprAsync(cfg.value, $vars, opts);
      effects.push({ _effect: "SHOW_VALUE", name, value });
      return;
    }
    if (type === "CALL_API") {
      const url = await resolveExprAsync(cfg.url, $vars, opts);
      if (!url) return;
      const method = String(cfg.method || "GET").toUpperCase();
      const headers = await deepResolveExprAsync(cfg.headers || {}, $vars, opts);
      const query = await deepResolveExprAsync(cfg.query || {}, $vars, opts);
      const body = cfg.body != null ? await deepResolveExprAsync(cfg.body, $vars, opts) : null;
      const timeoutMs = Math.min(60000, Math.max(1000, Number(cfg.timeoutMs) || 10000));
      const responseVar = cfg.responseVar || "$apiResponse";
      const onError = cfg.onError === "continue" ? "continue" : "fail";
      const errorVar = cfg.errorVar || "$apiError";

      const init = { method, headers: { ...headers } };
      if (body != null && method !== "GET") {
        init.body = typeof body === "string" ? body : JSON.stringify(body);
        if (typeof body !== "string" && !init.headers["Content-Type"]) {
          init.headers["Content-Type"] = "application/json";
        }
      }
      const finalUrl = appendQuery(url, query);

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(finalUrl, { ...init, signal: ctrl.signal });
        clearTimeout(timer);
        const ct = res.headers.get("content-type") || "";
        const parsed = ct.includes("application/json")
          ? await res.json().catch(() => null)
          : await res.text();
        if (!res.ok) {
          if (onError === "continue") {
            $vars[errorVar] = { status: res.status, body: parsed };
            return;
          }
          throw new Error(`CALL_API ${method} ${finalUrl} → ${res.status}`);
        }
        $vars[responseVar] = parsed;
      } catch (err) {
        clearTimeout(timer);
        if (onError === "continue") {
          $vars[errorVar] = { status: 0, message: String(err?.message || err) };
          return;
        }
        throw err;
      }
      return;
    }
    if (step.type === "if") {
      // The IF block's predicate sits on step.condition, not cfg.
      const group = step.condition || { operator: "AND", rules: step.rules || [] };
      const branch = evalGroup(group, $vars) ? (step.then || []) : (step.else || []);
      for (const s of branch) await executeStep(s);
      return;
    }
    if (step.type === "loop") {
      const overExpr = step.overExpr || step.over;
      const items = resolveExpr(overExpr, $vars);
      const as = step.as || "$item";
      if (Array.isArray(items)) {
        for (let i = 0; i < items.length; i++) {
          $vars[as] = items[i];
          $vars[`${as}.__index`] = i;
          for (const s of step.body || []) await executeStep(s);
        }
      }
      return;
    }
    // Unknown action type — silently skip (this executor is intentionally
    // a subset; complex ops need the browser-tab executor for now).
  }

  try {
    for (const step of op?.pipeline?.steps || []) {
      await executeStep(step);
    }
  } catch (err) {
    return {
      ok: false,
      error: { code: "execution_error", message: String(err?.message || err) },
      durationMs: Date.now() - startedAt,
      vars: {},
      effects,
    };
  }

  // Harvest SHOW_VALUE effects into the response's `vars` map (matches
  // the client bridge's behavior in onRunOpForApi).
  const responseVars = {};
  for (const eff of effects) {
    if (eff._effect === "SHOW_VALUE") responseVars[eff.name] = eff.value;
  }
  return {
    ok: true,
    durationMs: Date.now() - startedAt,
    vars: responseVars,
    effects,
  };
}
