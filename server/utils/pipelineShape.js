// server/utils/pipelineShape.js — ONE stored shape for an operation's steps.
//
// The operations editor reads and writes `{ id, type: "action", config: { type, ... } }`
// and conditions as `{ operator, rules }`. The seed wrote a second dialect for a
// handful of operations — `{ type: "action", action, cfg }`, conditions keyed
// `conjunction`, no step ids. The executor read both, so the ops ran; the EDITOR
// read only `config`, so opening one showed every action as a blank default and
// saving it would have written the blanks back (found 2026-10-03 rebuilding
// Movies Watched by clicking). This turns the seed dialect into the editor's.
import crypto from "node:crypto";

const stepId = () => crypto.randomBytes(5).toString("base64url").replace(/[^a-z0-9]/gi, "").slice(0, 7).toLowerCase() || "s" + Date.now().toString(36);

/** A condition / predicate group: `conjunction` -> `operator`, recursively. */
export function normalizeGroup(g) {
  if (!g || typeof g !== "object" || !Array.isArray(g.rules)) return g;
  const { conjunction, ...rest } = g;
  const out = { ...rest, operator: rest.operator || conjunction || "AND" };
  out.rules = g.rules.map((r) => (r && Array.isArray(r.rules) ? normalizeGroup(r) : r));
  return out;
}

function normalizeConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return cfg;
  return cfg.predicate ? { ...cfg, predicate: normalizeGroup(cfg.predicate) } : cfg;
}

/** PURE. Steps in either dialect -> the editor's dialect. Idempotent. */
export function normalizeSteps(steps) {
  return (steps || []).map((s) => {
    if (!s || typeof s !== "object") return s;
    const n = { ...s };
    if (!n.id) n.id = stepId();
    if (s.type === "action" && !s.config && (s.action || s.cfg)) {
      const { action, cfg, ...rest } = n;
      Object.assign(n, rest);
      delete n.action; delete n.cfg;
      n.config = { type: action, ...(cfg || {}) };
    }
    if (n.config) n.config = normalizeConfig(n.config);
    if (n.condition) n.condition = normalizeGroup(n.condition);
    for (const k of ["then", "else", "body"]) if (Array.isArray(s[k])) n[k] = normalizeSteps(s[k]);
    return n;
  });
}

/** True when a pipeline still carries the seed dialect anywhere. */
export function hasSeedDialect(steps) {
  const s = JSON.stringify(steps || []);
  return /"action":"[A-Z_]+"/.test(s) || /"cfg":\{/.test(s) || /"conjunction":/.test(s);
}
