// services/serverExecutor.js
//
// Headless executor for /api/v1/operations/:id/run when no browser tab
// is connected. Handles the subset of action types needed for typical
// CALL_API / integration ops:
//
//   INIT_VAR / SET_VAR — set a $var from an expression
//   IF + AND/OR/NOT predicates with basic comparators
//   LOOP over an array $var (as / overExpr)
//   CALL_API — outbound HTTP
//   SHOW_VALUE — stage a named result for the caller
//   CREATE — mint a row (via services/occurrenceMint), WITH fieldBindings
//   FIND — resolve one occurrence over $allContainers / $allInstances /
//          $allOccurrences by predicate, binding itemIdVar / itemVar (null
//          when nothing matches — never throws on a miss)
//
// Still client-only: COPY_LINK / APPLY_TEMPLATE / aggregations / the rest.
// Anything outside this list is collected in the returned `unsupported[]`
// rather than silently skipped.
//
// Per docs/api-plan.md §2.

import Secret from "../models/Secret.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Folder from "../models/Folder.js";
import { mintOccurrence } from "./occurrenceMint.js";

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

// Dot-walk a record for FIND's predicates. Mirrors operationActions.js's
// resolveRecordPath (client) for the subset FIND needs server-side, including
// the legacy `$item.`/`$record.` prefix some seeded predicates still carry
// (e.g. `$record._ancestors HAS_ANCESTOR <library>`, seen in optionsSource
// find predicates on the live grid).
//
// REVIEW FIX (Critical 1): this is now the ONLY path a FIND's `rule.left`
// takes. The prior version routed through an `isBareRecordPath` guard that
// returned false for anything starting with "$" — which excluded the very
// `$item.`/`$record.` prefixes this function exists to strip, so a predicate
// written that way silently fell through to `resolveExpr($vars)`, resolved to
// undefined, and matched nothing. The CLIENT's own FIND
// (`operationActions.js` `evalRuleAgainstRecord` → `resolveRecordPath`) has
// no such branch: every `rule.left` in a FIND predicate is a record path,
// unconditionally. There is no `$vars` fallback here to diverge from.
function resolveRecordPath(record, path) {
  if (record == null || !path) return null;
  const normalized = path.startsWith("$item.") ? path.slice(6)
    : path.startsWith("$record.") ? path.slice(8)
    : path;
  const parts = String(normalized).split(".");
  let cur = record;
  for (const seg of parts) {
    if (cur == null) return null;
    cur = cur[seg];
  }
  return cur ?? null;
}

// Minimal predicate eval: AND/OR with rules { left, comparator, right }.
// Supports a subset of comparators — enough for typical guards.
//
// `record`, when supplied (FIND only), routes `left` through
// resolveRecordPath unconditionally — every other caller (IF) passes no
// record and keeps the original $vars-only behavior.
function evalGroup(group, $vars, record = null) {
  if (!group) return true;
  const op = (group.operator || "AND").toUpperCase();
  const rules = group.rules || [];
  const evaluated = rules.map(r => {
    if (r.operator) return evalGroup(r, $vars, record);
    return evalRule(r, $vars, record);
  });
  if (op === "OR") return evaluated.some(Boolean);
  if (op === "NOT") return !evaluated.every(Boolean);
  return evaluated.every(Boolean);
}

function evalRule(rule, $vars, record = null) {
  const left = record
    ? resolveRecordPath(record, rule.left)
    : resolveExpr(rule.left, $vars);
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

// REVIEW FIX (Important 4, cheap half only — per Ruling 16, no DB-side
// pushdown). Mirrors the client's `singleIdEquals`
// (client/src/helpers/operationActions.js:1580-1590) bit for bit: the id a
// predicate asks for when it is EXACTLY `id IS <x>` (with or without a legacy
// `$item.`/`$record.` prefix), else null. One plain rule only — a second
// rule, a nested group, or any other comparator still needs the full scan.
// The client's own comment records why this exists: a bare `id IS <x>` FIND
// walking every record cost 65-80ms per op on a ~22,000-occurrence grid.
function singleIdEquals(predicate, $vars) {
  const rules = predicate?.rules;
  if (!Array.isArray(rules) || rules.length !== 1) return null;
  const r = rules[0];
  if (!r || Array.isArray(r.rules) || r.comparator !== "IS") return null;
  const left = typeof r.left === "string" ? r.left.replace(/^\$(item|record)\./, "") : "";
  if (left !== "id") return null;
  const v = resolveExpr(r.right, $vars);
  return typeof v === "string" && v ? v : null;
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
export async function runOperationServerSide(op, { vars = {}, userId, gridId, io = null, mirror = null } = {}) {
  const startedAt = Date.now();
  const $vars = {};
  // Fold caller vars (both "$foo" and "foo" forms).
  for (const [k, v] of Object.entries(vars || {})) {
    $vars[k.startsWith("$") ? k : `$${k}`] = v;
  }

  const effects = [];
  const unsupported = [];
  // Loop positions of the step being run, outermost first — part of a CREATE's
  // default share key, so a LOOP of creates does not collapse to one row.
  const loopPath = [];
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
    if (type === "CREATE") {
      // Server-side row creation. Wires to `occurrenceMint`, the same path
      // `/api/v1/ingest` uses — this executor does not own a second minter.
      //
      // gridId is REQUIRED here, not just documented as such. Without this
      // guard an undefined gridId reaches Mongo silently: mintOccurrence's own
      // existence lookup becomes `findOne({ userId, gridId: undefined, ... })`,
      // which can match a row on the WRONG grid, and a mint with no match
      // writes a new occurrence carrying `gridId: undefined` — a silent
      // wrong-grid write. Refuse loudly instead; the outer try/catch turns
      // this into a structured execution_error.
      if (!gridId) {
        throw new Error("CREATE requires gridId — runOperationServerSide was called without it");
      }
      // TWO SPELLINGS, ONE ACTION. The operations editor (client
      // blocks/OperationsBuilder.jsx) and the client executor write a CREATE
      // as `name` / `parent` / `role` / `kind` / `attachFields`; this
      // executor was written against `label` / `parentId` / `moduleRole` /
      // `moduleKind` / `bindFields`. A share rule built by CLICKING in the
      // Imports tab would therefore have run here with no label and no
      // parent — a row nothing renders. Both are read; the server's own
      // name wins when a step carries both.
      const parentId   = await resolveExprAsync(cfg.parentId ?? cfg.parent, $vars, opts);
      const label      = await resolveExprAsync(cfg.label ?? cfg.name, $vars, opts);
      let externalId   = await resolveExprAsync(cfg.externalId, $vars, opts);
      // The editor has no externalId box. Inside a share rule, a row with none
      // is keyed on the share + THIS step (+ loop position), so re-sharing the
      // same thing updates the same row instead of refusing or duplicating.
      if (!externalId && $vars.$share?.externalId) {
        externalId = [$vars.$share.externalId, step.id || "create", ...loopPath].join("::");
      }

      // Values, resolved one at a time so a $var in any of them works.
      //
      // `fieldsFrom` names a WHOLE field map held in a variable — the
      // extension's clip carries its `{ fieldId: { value, flow } }` already
      // resolved by field NAME against this grid, and a rule cannot know those
      // ids ahead of time. Explicit `fields` entries win over it.
      const fields = {};
      const fromMap = cfg.fieldsFrom ? await resolveExprAsync(cfg.fieldsFrom, $vars, opts) : null;
      if (isObject(fromMap)) {
        for (const [fid, cell] of Object.entries(fromMap)) {
          const value = isObject(cell) && "value" in cell ? cell.value : cell;
          if (value !== undefined && value !== null && value !== "") {
            fields[fid] = { value, flow: (isObject(cell) && cell.flow) || "in" };
          }
        }
      }
      for (const [fid, expr] of Object.entries(cfg.fields || {})) {
        const value = await resolveExprAsync(expr, $vars, opts);
        if (value !== undefined && value !== null && value !== "") {
          fields[fid] = { value, flow: "in" };
        }
      }

      // BINDINGS (D17). Default: bind exactly what we wrote. `bindFields`
      // widens that so a field can be bound with NO value — which is what puts
      // an ics row in front of `Schedule: Place Dated Work`, since that op
      // gates on `_boundFieldIds`, not on the value.
      const explicitBind = [
        ...(Array.isArray(cfg.bindFields) ? cfg.bindFields : []),
        ...(Array.isArray(cfg.attachFields) ? cfg.attachFields : []),
      ].filter(Boolean);
      const bindIds = explicitBind.length
        ? [...new Set([...explicitBind, ...Object.keys(fields)])]
        : Object.keys(fields);
      const fieldBindings = bindIds.map((fieldId, order) => ({ fieldId, role: "input", order }));

      // A FOLDER parent (the share catch-all's Files folder) is its own key:
      // a folder holds rows by `parentId` alone and has no occurrences[] to
      // push onto, so it must not go through the occurrence-parent path.
      // Validated here, on THIS grid — a folder id from another grid is
      // refused rather than written into.
      const parentFolderId = await resolveExprAsync(cfg.parentFolderId, $vars, opts);
      if (parentFolderId) {
        const folder = await Folder.findOne({ id: parentFolderId, userId, gridId }).lean();
        if (!folder) throw new Error(`CREATE: folder ${parentFolderId} not found on this grid`);
      }

      const moduleRole = (await resolveExprAsync(cfg.moduleRole ?? cfg.role, $vars, opts)) || "instance";
      const moduleKind = (await resolveExprAsync(cfg.moduleKind ?? cfg.kind, $vars, opts)) || null;
      const moduleFileRef = (await resolveExprAsync(cfg.moduleFileRef, $vars, opts)) || null;
      // `meta` is either an expression naming an object (share rules:
      // "$share.clip.meta") or, as the editor writes it, an object whose VALUES
      // are expressions — resolved one by one, as the client executor does.
      let metaVal = null;
      if (isObject(cfg.meta)) {
        metaVal = {};
        for (const [k, v] of Object.entries(cfg.meta)) metaVal[k] = (await resolveExprAsync(v, $vars, opts)) ?? v;
      } else if (cfg.meta) {
        metaVal = await resolveExprAsync(cfg.meta, $vars, opts);
      }

      const res = await mintOccurrence({
        userId, gridId, label, parentId, parentFolderId, fields, fieldBindings, externalId,
        moduleRole, moduleKind, moduleFileRef,
        // A `fileRef` IS a module's identity when it has one — /ingest's own
        // rule (a bookmark is keyed by its URL). Reusing the module keeps a
        // clip routed through /share landing on the SAME module the old
        // /ingest path would have found.
        resolveModule: moduleFileRef
          ? async () => Module.findOne({ userId, gridId, role: moduleRole, fileRef: moduleFileRef }).lean()
          : null,
        meta: isObject(metaVal) ? metaVal : {},
        source: (await resolveExprAsync(cfg.source, $vars, opts)) || "share",
        io, mirror,
      });
      if (cfg.resultVar) $vars[cfg.resultVar] = res;
      // The editor's names for "remember what I made" (client CREATE sets both).
      if (cfg.itemIdVar) $vars[cfg.itemIdVar] = res?.occurrenceId ?? null;
      if (cfg.itemVar) $vars[cfg.itemVar] = res ?? null;
      effects.push({ _effect: "CREATE", ...res });
      return;
    }
    if (type === "FIND") {
      // Server-side resolution — a share rule locating a destination
      // container (or an existing option row) with no browser tab.
      //
      // Same `gridId` reasoning as CREATE, but the failure mode is a READ
      // instead of a WRITE: an undefined gridId reaching Mongo does not miss
      // cleanly — `Occurrence.find({ userId, gridId: undefined })` drops the
      // undefined key entirely, so the query becomes `{ userId }` and matches
      // occurrences across EVERY grid the user owns. A FIND that "succeeds"
      // that way can hand a wrong-grid id to a CREATE's parentId right after,
      // which is a silent cross-grid write with no error anywhere. Refuse
      // loudly instead, same as CREATE.
      if (!gridId) {
        throw new Error("FIND requires gridId — runOperationServerSide was called without it");
      }
      const roleFor = { $allContainers: "container", $allInstances: "instance" };
      const role = roleFor[cfg.over] || null;
      const mods = await Module.find({ userId, gridId, ...(role ? { role } : {}) }).lean();
      const modById = Object.fromEntries(mods.map(m => [m.id, m]));
      const occs = await Occurrence.find({ userId, gridId }).lean();

      // A record's label falls back to its module's — mirrors the client
      // executor's enrichment (operationExecutor.js `enrichOne`:
      // `label: occ.label ?? tpl?.label ?? tpl?.name ?? null`), which is what
      // a predicate's bare `label` path expects to read.
      //
      // REVIEW FIX (Critical 2): excludes anything carrying `meta.isTemplate`
      // on either the occurrence or its module (occurrence wins, mirroring
      // the client's `meta: {...tpl.meta, ...occ.meta}` merge order). The
      // client's own FIND filters `!it.meta?.isTemplate` before evaluating
      // any predicate (operationActions.js:1592) — a template scaffold (e.g.
      // the day-page template, `meta.isTemplate:true` per
      // createDefaultUserData.js) is not a real row and the UI never offers
      // it as a match. Filtered upstream of BOTH the scan and the id fast
      // path below, so neither has to repeat the check.
      const records = occs
        .filter(o => !role || modById[o.moduleId]?.role === role)
        .filter(o => {
          const mod = modById[o.moduleId];
          const mergedIsTemplate = (o.meta && "isTemplate" in o.meta) ? o.meta.isTemplate : mod?.meta?.isTemplate;
          return !mergedIsTemplate;
        })
        .map(o => ({ ...o, label: o.label || modById[o.moduleId]?.label || "" }));

      // A bare `id IS <x>` predicate is a lookup, not a scan (Important 4) —
      // skip evalGroup's per-record resolveRecordPath/comparator work
      // entirely rather than run it once per record just to compare `id`.
      const wantedId = singleIdEquals(cfg.predicate, $vars);
      let match;
      if (wantedId != null) {
        const recordsById = new Map(records.map(r => [r.id, r]));
        match = recordsById.get(wantedId) ?? null;
      } else {
        match = records.find(r => evalGroup(cfg.predicate, $vars, r)) ?? null;
      }
      if (cfg.itemIdVar) $vars[cfg.itemIdVar] = match?.id ?? null;
      if (cfg.itemVar) $vars[cfg.itemVar] = match ?? null;
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
          loopPath.push(i);
          try {
            for (const s of step.body || []) await executeStep(s);
          } finally { loopPath.pop(); }
        }
      }
      return;
    }
    // Unknown action type — this executor is intentionally a subset; complex
    // ops need the browser-tab executor for now. Record it rather than
    // silently skipping, so a caller can tell "ran everything" from "ran
    // everything IT KNOWS HOW TO RUN".
    if (type) unsupported.push(type);
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
      scope: { ...$vars },
      effects,
      unsupported,
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
    // The WHOLE variable scope at the end of the run. `vars` above is only
    // what SHOW_VALUE published (the /operations/:id/run contract); a caller
    // that chains runs — the share engine reading `$share.handled` between
    // rules (D9) — needs what the pipeline actually SET.
    scope: { ...$vars },
    effects,
    unsupported,
  };
}
