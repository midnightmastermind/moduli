// operationIntrospection.js
// Pure static analyzer over an Operation's pipeline. Returns an
// IntrospectionRecord — ten sets describing what the op reads, writes,
// triggers off of, and invokes — that gets exposed to the path picker via
// `$allOperations` so authors can write predicates like:
//
//   $op.fields_written CONTAINS field:<fid>          — find ops that write a field
//   $op.triggered_by_occurrences HAS_ANCESTOR $page  — find ops scoped to a page
//   $op.invokes_operations CONTAINS $someOpId        — find ops that call another
//
// Implementation: walks `op.pipeline.steps[]` recursively (LOOP body, IF
// then/else) plus `op.triggerObjects[]` and `op.pipeline.sources[]`. Each
// step-type case contributes to specific sets; a generic string-scanner runs
// over every cfg leaf to catch fieldId/occurrenceId references that show up
// inside resolveExpr-style string expressions. Unknown step types are walked
// into structurally (descend into anything that looks like a nested step
// array) so the analyzer keeps producing useful output as new actions land.
//
// Sets are returned as ARRAYS (deduped via Set internally, materialized at
// the boundary). The executor passes the record directly into `$vars.$allOperations`,
// and arrays serialize cleanly through evalRule's CONTAINS/HAS_ANCESTOR
// comparators.

const OCCURRENCE_TRIGGER_SUBJECT_TYPES = new Set([
  "occurrence", "instance", "container", "panel", "page",
]);

const OCCURRENCE_SOURCE_ENTITY_TYPES = new Set([
  "occurrence", "instance", "container", "panel", "page",
  "allOccurrences", "allContainers", "allPages", "allInstances", "allTemplates",
  "effectiveFilter",
]);

const FIELD_SOURCE_ENTITY_TYPES = new Set(["field", "localField"]);

// Regex: capture `field:<id>` token suffixes that aren't otherwise wrapped in
// JSON keys. Allow alphanumeric, dash, underscore. The id-existence check
// against `fieldsById` happens at the call site — this regex is purely a
// candidate-extractor.
const FIELD_TOKEN_RE = /\bfield:([A-Za-z0-9_-]+)/g;

// Regex: capture `$<var>.fields.<fid>...` patterns where <fid> is the
// fieldId. Same alphanumeric character class.
const VAR_FIELDS_RE = /\$[A-Za-z0-9_]+\.fields\.([A-Za-z0-9_-]+)/g;

// Add a non-null value to a Set (helper to keep call sites clean).
function add(set, v) {
  if (v == null) return;
  if (typeof v !== "string") return;
  if (!v) return;
  set.add(v);
}

// Walk every string leaf inside `value` (any nested object/array) and feed
// it to `visit(str)`. Stops at non-string leaves. Cheap — no clone, no
// allocation beyond the call stack.
function walkStringLeaves(value, visit) {
  if (value == null) return;
  if (typeof value === "string") { visit(value); return; }
  if (Array.isArray(value)) {
    for (const item of value) walkStringLeaves(item, visit);
    return;
  }
  if (typeof value === "object") {
    for (const k in value) {
      if (Object.prototype.hasOwnProperty.call(value, k)) walkStringLeaves(value[k], visit);
    }
  }
}

// Scan a single string for fieldId references. Pushes any tokens whose
// suffix matches a known fieldId into `fieldsRead`. Same for any
// occurrence-id literal embedded in the string.
function scanStringForReferences(str, fieldsById, occurrencesById, fieldsRead, occsRead) {
  // Field tokens: field:<id>
  let m;
  FIELD_TOKEN_RE.lastIndex = 0;
  while ((m = FIELD_TOKEN_RE.exec(str)) != null) {
    const fid = m[1];
    if (!fieldsById || fieldsById[fid]) add(fieldsRead, fid);
  }
  // Var fields: $foo.fields.<fid>
  VAR_FIELDS_RE.lastIndex = 0;
  while ((m = VAR_FIELDS_RE.exec(str)) != null) {
    const fid = m[1];
    if (!fieldsById || fieldsById[fid]) add(fieldsRead, fid);
  }
  // Hard-coded occurrence-id literal — only if the string IS an occurrence
  // id (whole-string match), not substring; substring matches produce too
  // many false positives.
  if (occurrencesById && occurrencesById[str]) {
    add(occsRead, str);
  }
}

// True when `value` looks like a single occurrence id (raw string) or an
// expression that resolves to one ($var, $var.id). Strings that are
// arbitrary expressions can't be detected reliably — false negatives are
// fine; this is only used to seed `occurrences_written` from likely-target
// configs (e.g. UPDATE's itemId / cfg.target). The string-scanner separately
// captures references buried inside expressions.
function looksLikeOccurrenceRef(value) {
  if (typeof value !== "string" || !value) return false;
  if (value.startsWith("$")) return true;
  // Bare id heuristic — must be at least 8 chars, only alnum/-/_, no spaces.
  return /^[A-Za-z0-9_-]{8,}$/.test(value);
}

// Per-action-type writer/reader contributions. Each handler receives the
// action's `cfg` plus the four mutable sets. The generic string-scanner
// runs separately over the entire cfg afterwards — handlers here only
// declare DIRECT structural contributions (e.g. cfg.fieldId → fields_written).
const ACTION_HANDLERS = {
  CREATE(cfg, sets) {
    if (cfg.fields && typeof cfg.fields === "object") {
      for (const fid of Object.keys(cfg.fields)) add(sets.fields_written, fid);
    }
    if (looksLikeOccurrenceRef(cfg.parent)) add(sets.occurrences_read, cfg.parent);
    if (cfg.role || cfg.kind) {
      const mod = `${cfg.role || ""}:${cfg.kind || ""}`;
      if (mod !== ":") add(sets.created_modules, mod);
    }
  },
  CREATE_ITEM(cfg, sets) { ACTION_HANDLERS.CREATE(cfg, sets); },
  CREATE_OCCURRENCE_FOR_MODULE(cfg, sets) {
    if (looksLikeOccurrenceRef(cfg.parentId)) add(sets.occurrences_read, cfg.parentId);
    if (cfg.fields && typeof cfg.fields === "object") {
      for (const fid of Object.keys(cfg.fields)) add(sets.fields_written, fid);
    }
  },
  CREATE_MODULE(cfg, sets) {
    if (cfg.role || cfg.kind) {
      const mod = `${cfg.role || ""}:${cfg.kind || ""}`;
      if (mod !== ":") add(sets.created_modules, mod);
    }
  },

  UPDATE(cfg, sets) {
    // UPDATE writes a field on an occurrence, OR an arbitrary path on an
    // occurrence (meta / textmap / etc.). cfg.fieldId → fields_written;
    // cfg.itemId/cfg.target → occurrences_written.
    if (cfg.fieldId) add(sets.fields_written, cfg.fieldId);
    for (const k of ["itemId", "target", "occurrenceId"]) {
      if (looksLikeOccurrenceRef(cfg[k])) add(sets.occurrences_written, cfg[k]);
    }
  },
  UPDATE_ITEM_FIELD(cfg, sets) { ACTION_HANDLERS.UPDATE(cfg, sets); },
  UPDATE_ITEM_META(cfg, sets)  {
    for (const k of ["itemId", "target", "occurrenceId"]) {
      if (looksLikeOccurrenceRef(cfg[k])) add(sets.occurrences_written, cfg[k]);
    }
  },
  UPDATE_ITEM_TEXTMAP(cfg, sets) { ACTION_HANDLERS.UPDATE_ITEM_META(cfg, sets); },
  UPDATE_ITEM_PARENT(cfg, sets) {
    for (const k of ["itemId", "target", "occurrenceId", "newParentId"]) {
      if (looksLikeOccurrenceRef(cfg[k])) add(sets.occurrences_written, cfg[k]);
    }
  },
  SET_FIELD_VALUE(cfg, sets) {
    if (cfg.fieldId) add(sets.fields_written, cfg.fieldId);
    for (const k of ["itemId", "occurrenceId"]) {
      if (looksLikeOccurrenceRef(cfg[k])) add(sets.occurrences_written, cfg[k]);
    }
  },
  INCREMENT_FIELD(cfg, sets) { ACTION_HANDLERS.SET_FIELD_VALUE(cfg, sets); },
  MARK_COMPLETE(cfg, sets)   { ACTION_HANDLERS.SET_FIELD_VALUE(cfg, sets); },

  DELETE(cfg, sets) {
    for (const k of ["itemId", "target", "occurrenceId"]) {
      if (looksLikeOccurrenceRef(cfg[k])) add(sets.occurrences_written, cfg[k]);
    }
  },
  DELETE_ITEM(cfg, sets)        { ACTION_HANDLERS.DELETE(cfg, sets); },
  REMOVE_OCCURRENCE(cfg, sets)  { ACTION_HANDLERS.DELETE(cfg, sets); },

  FIND(cfg, sets) {
    for (const k of ["itemId", "targetId", "occurrenceId"]) {
      if (looksLikeOccurrenceRef(cfg[k])) add(sets.occurrences_read, cfg[k]);
    }
  },
  FIND_OCCURRENCE(cfg, sets) { ACTION_HANDLERS.FIND(cfg, sets); },
  FIND_MODULE(cfg, sets)     { ACTION_HANDLERS.FIND(cfg, sets); },

  COPY_LINK(cfg, sets) {
    if (looksLikeOccurrenceRef(cfg.sourceId)) add(sets.occurrences_read, cfg.sourceId);
    if (looksLikeOccurrenceRef(cfg.parent))   add(sets.occurrences_read, cfg.parent);
    if (cfg.fields && typeof cfg.fields === "object") {
      for (const fid of Object.keys(cfg.fields)) add(sets.fields_written, fid);
    }
  },

  APPLY_TEMPLATE(cfg, sets) {
    if (looksLikeOccurrenceRef(cfg.templateOccurrenceId)) {
      add(sets.templates_used, cfg.templateOccurrenceId);
    }
    if (looksLikeOccurrenceRef(cfg.targetOccurrenceId)) {
      add(sets.occurrences_written, cfg.targetOccurrenceId);
    }
    if (looksLikeOccurrenceRef(cfg.rootParent)) {
      add(sets.occurrences_written, cfg.rootParent);
    }
  },
  FILL_FROM_TEMPLATE(cfg, sets) {
    if (looksLikeOccurrenceRef(cfg.templateOccurrenceId)) {
      add(sets.templates_used, cfg.templateOccurrenceId);
    }
    if (looksLikeOccurrenceRef(cfg.targetOccurrenceId)) {
      add(sets.occurrences_written, cfg.targetOccurrenceId);
    }
  },
  COMPUTE_TEXTMAP_FROM_TEMPLATE(cfg, sets) {
    if (looksLikeOccurrenceRef(cfg.templateOccurrenceId)) {
      add(sets.templates_used, cfg.templateOccurrenceId);
    }
  },

  ADD_CHILD(cfg, sets) {
    if (looksLikeOccurrenceRef(cfg.parentId)) add(sets.occurrences_written, cfg.parentId);
  },
  LINK_OCCURRENCE_TO_PARENT(cfg, sets) {
    if (looksLikeOccurrenceRef(cfg.parentOccurrenceId)) add(sets.occurrences_written, cfg.parentOccurrenceId);
  },

  RUN_OPERATION(cfg, sets, { operationsByName, operationsById }) {
    if (cfg.operationId && (!operationsById || operationsById[cfg.operationId])) {
      add(sets.invokes_operations, cfg.operationId);
    } else if (cfg.operationName && operationsByName) {
      const op = operationsByName[cfg.operationName];
      if (op?.id) add(sets.invokes_operations, op.id);
    }
  },

  ADD_TO_POOL(cfg, sets) {
    if (looksLikeOccurrenceRef(cfg.poolContainerId)) add(sets.occurrences_written, cfg.poolContainerId);
  },
  REMOVE_FROM_POOL(cfg, sets) {
    if (looksLikeOccurrenceRef(cfg.occurrenceId)) add(sets.occurrences_written, cfg.occurrenceId);
  },
};

// Walk a step array recursively. `step.type === "action"` → run the
// per-action handler + the generic scanner. `if` → walk then + else.
// `loop` → walk body. Unknown shapes: descend into anything looking like a
// nested step array (defensive against future action types).
function walkSteps(steps, sets, ctx) {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    if (step.type === "action") {
      const actionType = step.config?.type || step.actionType;
      const cfg = step.config || {};
      const handler = ACTION_HANDLERS[actionType];
      if (handler) handler(cfg, sets, ctx);
      // Generic string scan over the cfg — catches `field:<id>` tokens and
      // `$var.fields.<fid>` patterns buried inside arbitrary string
      // expressions, regardless of action type.
      walkStringLeaves(cfg, (str) => {
        scanStringForReferences(str, ctx.fieldsById, ctx.occurrencesById, sets.fields_read, sets.occurrences_read);
      });
      // Predicate scan — left-hand record paths show up as bare keys
      // (`fields.<fid>.value`, `_ancestors`), which the regex above won't
      // hit because they lack the `$var.` prefix. Catch them explicitly.
      if (cfg.predicate?.rules) walkPredicateForFieldRefs(cfg.predicate, sets, ctx);
    } else if (step.type === "if") {
      // Condition rules also reference fields.
      const group = step.condition || (step.rules ? { operator: "AND", rules: step.rules } : null);
      if (group) walkPredicateForFieldRefs(group, sets, ctx);
      walkSteps(step.then, sets, ctx);
      walkSteps(step.else, sets, ctx);
    } else if (step.type === "loop") {
      // Loop expression itself can reference vars / fields.
      if (typeof step.overExpr === "string") {
        scanStringForReferences(step.overExpr, ctx.fieldsById, ctx.occurrencesById, sets.fields_read, sets.occurrences_read);
      }
      walkSteps(step.body, sets, ctx);
    } else {
      // Defensive recurse — descend into anything that looks like a
      // nested step array (handles unknown wrappers).
      walkStringLeaves(step, (str) => {
        scanStringForReferences(str, ctx.fieldsById, ctx.occurrencesById, sets.fields_read, sets.occurrences_read);
      });
      if (Array.isArray(step.steps)) walkSteps(step.steps, sets, ctx);
    }
  }
}

// Walk a predicate group recursively, extracting bare-record-path fieldIds.
// `rule.left` examples that appear in seeded data:
//   "templateId", "_ancestors", "fields.<fid>.value", "meta.scheduleSlot"
// The fieldsById guard prevents false positives when the path's last segment
// happens to look fieldId-shaped but isn't one.
function walkPredicateForFieldRefs(group, sets, ctx) {
  if (!group || !Array.isArray(group.rules)) return;
  for (const rule of group.rules) {
    if (!rule) continue;
    if (Array.isArray(rule.rules)) { walkPredicateForFieldRefs(rule, sets, ctx); continue; }
    const left = rule.left;
    if (typeof left === "string") {
      // Bare `fields.<fid>(.value)?` path
      const m = left.match(/^(?:\$[A-Za-z0-9_]+\.)?fields\.([A-Za-z0-9_-]+)/);
      if (m) {
        const fid = m[1];
        if (!ctx.fieldsById || ctx.fieldsById[fid]) add(sets.fields_read, fid);
      }
      // Also run the standard scanner — picks up `field:<id>` tokens and
      // var-paths that aren't bare-record-path-shaped.
      scanStringForReferences(left, ctx.fieldsById, ctx.occurrencesById, sets.fields_read, sets.occurrences_read);
    }
    // Right-hand side: scan strings as expressions.
    if (typeof rule.right === "string") {
      scanStringForReferences(rule.right, ctx.fieldsById, ctx.occurrencesById, sets.fields_read, sets.occurrences_read);
    }
    // Nested objects (e.g. comparator-period configs) — scan all leaves.
    walkStringLeaves(rule, (str) => {
      scanStringForReferences(str, ctx.fieldsById, ctx.occurrencesById, sets.fields_read, sets.occurrences_read);
    });
  }
}

// Analyze a single operation. `ctx` supplies the existence-checked lookups
// (so a fieldId that doesn't exist on the grid is silently dropped — keeps
// the introspection sets clean). Pass empty object if you don't have ctx.
export function analyzeOperation(op, ctx = {}) {
  const sets = {
    fields_written:           new Set(),
    fields_read:              new Set(),
    occurrences_written:      new Set(),
    occurrences_read:         new Set(),
    triggered_by_fields:      new Set(),
    triggered_by_occurrences: new Set(),
    ancestor_scopes:          new Set(),
    invokes_operations:       new Set(),
    templates_used:           new Set(),
    created_modules:          new Set(),
  };

  if (!op || typeof op !== "object") return materialize(sets);

  // ── Trigger objects ──────────────────────────────────────────────────
  const triggers = Array.isArray(op.triggerObjects) ? op.triggerObjects : [];
  for (const t of triggers) {
    if (!t || typeof t !== "object") continue;
    if (t.subjectType === "field") {
      add(sets.triggered_by_fields, t.targetId);
    } else if (OCCURRENCE_TRIGGER_SUBJECT_TYPES.has(t.subjectType)) {
      add(sets.triggered_by_occurrences, t.targetId);
    }
    if (t.ancestorLabel) add(sets.ancestor_scopes, t.ancestorLabel);
  }

  // ── Pipeline sources ─────────────────────────────────────────────────
  const sources = Array.isArray(op.pipeline?.sources) ? op.pipeline.sources : [];
  for (const s of sources) {
    if (!s || typeof s !== "object") continue;
    if (FIELD_SOURCE_ENTITY_TYPES.has(s.entityType) && s.entityId) {
      add(sets.fields_read, s.entityId);
    } else if (OCCURRENCE_SOURCE_ENTITY_TYPES.has(s.entityType) && s.entityId) {
      add(sets.occurrences_read, s.entityId);
    }
  }

  // ── Pipeline steps ───────────────────────────────────────────────────
  walkSteps(op.pipeline?.steps, sets, ctx);

  return materialize(sets);
}

function materialize(sets) {
  const out = {};
  for (const k in sets) out[k] = Array.from(sets[k]);
  return out;
}

// Memoization wrapper: returns `Map<opId, IntrospectionRecord>` rekeyed
// whenever the underlying ops change by identity. The executor calls this
// once per pipeline run; the result is cached on the executor's context so
// each op only re-analyzes when its object identity changes (i.e. when the
// user edits it).
const _cache = new WeakMap();
export function analyzeAllOperations(operationsById, ctx = {}) {
  if (!operationsById) return {};
  const out = {};
  for (const id in operationsById) {
    const op = operationsById[id];
    if (!op) continue;
    let rec = _cache.get(op);
    if (!rec) {
      rec = analyzeOperation(op, ctx);
      _cache.set(op, rec);
    }
    out[id] = rec;
  }
  return out;
}
