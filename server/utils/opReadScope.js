// server/utils/opReadScope.js
//
// WHICH LOAD OPERATIONS NEED THE CATALOGUE.
//
// A load sends the pages shown in the panels first (utils/splitFullState.splitShownFirst), then the rest in two tiers:
// every row that is not an artifact, then the artifacts (songs, episodes, books, pictures: ~63% of the rest). The
// load sweep waited for all of it — ~10s on the user's connection (2026-11-14: rest 3.1s -> 9.7s, ops at 10.4s) —
// because running everything on half a grid once wrote wrong counts and duplicate day items (2026-11-06). User,
// 2026-11-14: split them by what they read, so the day builders run as soon as the rows they read are in.
//
// `$allInstances`, `$allContainers`, `$allPages`, `$allPanels` and `$allTextblocks` hold no artifacts, so once the
// first tier is in they are complete. An operation NEEDS THE CATALOGUE (runs after the artifacts) when it:
//   - counts over a collection (COUNT_BY), or reads `$allArtifacts`;
//   - reads `$allItems` / `$allOccurrences` without an AND rule `parentId IS x`, `id IS x` or
//     `_ancestors HAS_ANCESTOR x` (in the find's predicate, or in an IF that is a loop body's only step);
//   - confines such a read to a literal row with a held-back artifact below it;
//   - names a held-back artifact or its module;
//   - calls an operation that needs it.
// A row looked up by a COMPUTED id cannot be judged here; the client's early pass watches for a lookup of a row that
// has not arrived and runs that operation again later (client helpers/operationExecutor watchMisses).
// Anything it cannot recognise needs the catalogue: a wrong "early" writes from half a grid, a wrong "late" costs time.

const MIXED = new Set(["$allItems", "$allOccurrences"]);
const cfgOf = (s) => s?.config || s?.cfg || {};
const typeOf = (s) => s?.actionType || cfgOf(s).type || s?.type;
const stripLiteral = (v) => (typeof v === "string" && v.startsWith("literal:") ? v.slice(8) : v);

/** Leaf rules joined by AND from the group's top (a nested AND group counts, an OR group does not). */
function andRules(group) {
  const out = [];
  const walk = (g) => {
    if (!g || !Array.isArray(g.rules)) return;
    if (String(g.operator || g.conjunction || "AND").toUpperCase() !== "AND") return;
    for (const r of g.rules) (Array.isArray(r?.rules) ? walk(r) : out.push(r));
  };
  walk(group);
  return out;
}

/** The value a read is confined under, or null. */
function confinement(group) {
  for (const r of andRules(group)) {
    const left = typeof r?.left === "string" ? r.left.replace(/^\$(item|record)\./, "") : "";
    if (!r?.right) continue;
    if (left === "_ancestors" && r.comparator === "HAS_ANCESTOR") return r.right;
    if ((left === "parentId" || left === "id") && r.comparator === "IS") return r.right;
  }
  return null;
}

/** Every token in a value that could be an id; checked by exact membership against the held-back rows. */
function tokens(value, out) {
  if (typeof value === "string") {
    for (const t of value.split(/[^A-Za-z0-9_-]+/)) if (t.length >= 8) out.add(t);
  } else if (Array.isArray(value)) {
    for (const v of value) tokens(v, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) if (k !== "id") tokens(v, out);
  }
  return out;
}

/**
 * What an operation reads, from its pipeline alone. Pure.
 * @returns {{ needsCatalogue: boolean, reason?: string, literalRoots: Set<string>, ids: Set<string>, calls: string[] }}
 */
export function opReadPlan(op) {
  const literalRoots = new Set();
  const calls = [];
  const ids = tokens(op?.pipeline, new Set());
  const vars = {};
  let reason = null;

  const visit = (list) => {
    for (const s of list || []) {
      if (reason) return;
      const c = cfgOf(s);
      const t = typeOf(s);
      if (t === "RUN_OPERATION") calls.push(c.operationId || c.operationName || c.name || "");
      if (t === "COUNT_BY") { reason = "counts over a collection"; return; }
      if ((t === "INIT_VAR" || t === "SET_VAR") && c.name) {
        const v = c.value ?? c.expr;
        vars[c.name] = typeof v === "string" ? v : null;
      }
      const reads = [];
      for (const v of Object.values(c)) if (typeof v === "string") reads.push(v.trim());
      if (typeof s.overExpr === "string") reads.push(s.overExpr.trim());
      if (reads.includes("$allArtifacts")) { reason = "reads $allArtifacts"; return; }
      const mixed = reads.find((r) => MIXED.has(r));
      if (mixed) {
        let target = confinement(c.predicate || c.condition || c.where);
        if (!target && s.type === "loop") {
          const body = s.body || [];
          if (body.length === 1 && body[0]?.type === "if") target = confinement(body[0].condition);
        }
        if (!target) { reason = `reads ${mixed} with nothing confining it`; return; }
        let lit = stripLiteral(target);
        if (typeof lit === "string" && Object.prototype.hasOwnProperty.call(vars, lit) && vars[lit] && !String(vars[lit]).startsWith("$")) lit = stripLiteral(vars[lit]);
        if (typeof lit === "string" && !lit.startsWith("$")) literalRoots.add(lit);
      }
      visit(s.then); visit(s.else); visit(s.body);
    }
  };
  visit(op?.pipeline?.steps);
  return reason ? { needsCatalogue: true, reason, literalRoots, ids, calls } : { needsCatalogue: false, literalRoots, ids, calls };
}

/**
 * The ids of the operations that must wait for the catalogue (the held-back artifacts).
 * @param {Array} operations           every operation on the grid (callees are looked up here)
 * @param {{ occurrences: Array, catalogueIds: Set<string>, catalogueModuleIds?: Set<string> }} grid
 *   occurrences = the whole grid; catalogueIds = the artifact occurrences sent last
 * @returns {{ ids: string[], why: Object<string,string> }}  why: op name -> reason
 */
export function catalogueOps(operations = [], { occurrences = [], catalogueIds = new Set(), catalogueModuleIds = new Set() } = {}) {
  const kids = new Map();
  const add = (p, c) => { if (!p || !c || p === c) return; let a = kids.get(p); if (!a) kids.set(p, (a = [])); a.push(c); };
  for (const o of occurrences) {
    if (!o?.id) continue;
    for (const c of o.occurrences || []) add(o.id, c);
    if (o.parentId) add(o.parentId, o.id);
  }
  const holdsCatalogue = new Map();
  const rootHolds = (root) => {
    if (holdsCatalogue.has(root)) return holdsCatalogue.get(root);
    let found = catalogueIds.has(root);
    const seen = new Set([root]);
    const stack = [root];
    while (!found && stack.length) {
      for (const c of kids.get(stack.pop()) || []) {
        if (seen.has(c)) continue;
        seen.add(c);
        if (catalogueIds.has(c)) { found = true; break; }
        stack.push(c);
      }
    }
    holdsCatalogue.set(root, found);
    return found;
  };
  const byKey = new Map();
  for (const op of operations) { if (op?.id) byKey.set(op.id, op); if (op?.name) byKey.set(op.name, op); }
  const memo = new Map();
  const judge = (op, stack = new Set()) => {
    if (memo.has(op.id)) return memo.get(op.id);
    if (stack.has(op.id)) return "calls itself";
    stack.add(op.id);
    const plan = opReadPlan(op);
    let why = plan.needsCatalogue ? plan.reason : null;
    if (!why) { const r = [...plan.literalRoots].find(rootHolds); if (r) why = `reads under ${r}, which holds catalogue rows`; }
    if (!why) { const t = [...plan.ids].find((x) => catalogueIds.has(x) || catalogueModuleIds.has(x)); if (t) why = `names ${t}, a catalogue row`; }
    if (!why) {
      for (const k of plan.calls) {
        const callee = byKey.get(k);
        if (!callee) { why = `calls ${k || "an operation"} it cannot find`; break; }
        const w = judge(callee, stack);
        if (w) { why = `calls ${callee.name || k}, which ${w}`; break; }
      }
    }
    stack.delete(op.id);
    memo.set(op.id, why);
    return why;
  };
  const ids = [];
  const why = {};
  for (const op of operations) {
    if (!op?.id) continue;
    const w = judge(op);
    if (w) { ids.push(op.id); why[op.name || op.id] = w; }
  }
  return { ids, why };
}
