// scripts/inspectAutoBuild.js
// Dry-run the Schedule: Build Day operation against the live test grid in Mongo
// without touching the React/sonner-coupled client executor. Counts how many
// effects each major step would produce so we can verify the new arrayOf-driven
// slot loop generates 48 CREATE_ITEM effects on a fresh date.
//
// Mirrors the unified four-verb engine: FIND / CREATE / UPDATE / DELETE plus
// flow primitives. Items are pre-merged with their template (label/meta/role/
// kind) so predicates over `$item.label`, `$item.meta.<key>`, etc. resolve
// without a separate template lookup.

import "dotenv/config";
import mongoose from "mongoose";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";
import Field from "../models/Field.js";
import Grid from "../models/Grid.js";
import User from "../models/User.js";

function resolveExpr(expr, $vars) {
  if (expr == null) return null;
  if (typeof expr !== "string") return expr;
  if (expr === "") return null;
  if (expr.startsWith("literal:")) {
    const raw = expr.slice(8);
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (raw === "null") return null;
    if (!isNaN(Number(raw)) && /^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    return raw;
  }
  if (expr.includes("${")) {
    return expr.replace(/\$\{([^}]+)\}/g, (_, inner) => {
      const v = resolveExpr(inner.trim(), $vars);
      return v != null ? String(v) : "";
    });
  }
  if (expr.startsWith("$")) {
    const parts = expr.slice(1).split(".");
    const varName = `$${parts[0]}`;
    let cur = $vars[varName];
    if (cur == null) return null;
    for (let i = 1; i < parts.length; i++) {
      if (cur == null) return null;
      cur = cur[parts[i]];
    }
    return cur ?? null;
  }
  return expr;
}

function evalRule(rule, $vars) {
  const { left, comparator, right } = rule;
  const leftVal = resolveExpr(left, $vars);
  if (comparator === "IS_EMPTY") return leftVal == null || leftVal === "";
  if (comparator === "IS_NOT_EMPTY") return leftVal != null && leftVal !== "";
  const rightVal = resolveExpr(right, $vars) ?? right;
  switch (comparator) {
    case "IS": return String(leftVal) === String(rightVal);
    case "IS_NOT": return String(leftVal) !== String(rightVal);
    default: return false;
  }
}
function evalGroup(group, $vars) {
  const op = group.operator || "AND";
  const rules = group.rules || [];
  const evalEach = r => (r.rules ? evalGroup(r, $vars) : evalRule(r, $vars));
  return op === "AND" ? rules.every(evalEach) : rules.some(evalEach);
}

function executeActionItem(type, cfg, $vars, ctx) {
  const updates = [];
  switch (type) {
    case "INIT_VAR": {
      let val;
      if (cfg.arrayOf !== undefined) {
        val = (Array.isArray(cfg.arrayOf) ? cfg.arrayOf : [cfg.arrayOf]).map(x => resolveExpr(x, $vars));
      } else if (cfg.expr !== undefined) {
        val = resolveExpr(cfg.expr, $vars);
      } else {
        val = cfg.value;
      }
      $vars[cfg.name] = val !== undefined ? val : 0;
      break;
    }
    case "SET_VAR": {
      $vars[cfg.name] = resolveExpr(cfg.expr, $vars) ?? cfg.value ?? null;
      break;
    }
    case "INCREMENT_VAR": {
      const by = Number(cfg.by ?? 1);
      $vars[cfg.name] = (Number($vars[cfg.name]) || 0) + by;
      break;
    }
    case "ADD_TO_VAR": {
      $vars[cfg.name] = (Number($vars[cfg.name]) || 0) + (Number(resolveExpr(cfg.expr, $vars)) || 0);
      break;
    }

    case "FIND": {
      const items = Array.isArray($vars.$allItems) ? $vars.$allItems : [];
      const predicate = cfg.predicate;
      const matches = items.filter(it => {
        if (!it || it.deleted || it.meta?.isTemplate) return false;
        if (!predicate || !Array.isArray(predicate.rules) || predicate.rules.length === 0) return true;
        const prev = $vars.$item;
        $vars.$item = it;
        try { return evalGroup(predicate, $vars); }
        finally { $vars.$item = prev; }
      });
      let candidates = matches;
      if (cfg.scope?.dateFieldId) {
        const targetDate = resolveExpr(cfg.scope.dateExpr, $vars);
        const dayKey = v => {
          if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
          const d = new Date(v);
          return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
        };
        const tk = dayKey(targetDate);
        if (!tk) candidates = [];
        else candidates = candidates.filter(o => {
          const fv = o.fields?.[cfg.scope.dateFieldId];
          const v = fv?.value ?? fv;
          return dayKey(v) === tk;
        });
      }
      const result = cfg.multiple ? candidates : (candidates[0] || null);
      if (cfg.itemVar) $vars[cfg.itemVar] = result;
      if (cfg.itemIdVar) {
        $vars[cfg.itemIdVar] = cfg.multiple ? candidates.map(c => c.id) : (result?.id ?? null);
      }
      break;
    }

    case "CREATE": {
      const name = resolveExpr(cfg.name, $vars) ?? cfg.name;
      if (!name) break;
      const templates = Array.isArray($vars.$allTemplates) ? $vars.$allTemplates : [];
      const existing = templates.find(t => t && !t.trashed && (t.label === name || t.name === name));
      let templateId;
      if (existing) {
        templateId = existing.id;
      } else {
        templateId = `synth_tpl_${Math.random().toString(36).slice(2, 8)}`;
        const tpl = { id: templateId, name, label: name, role: cfg.role || "container", kind: cfg.kind || "doc", ...(cfg.meta ? { meta: cfg.meta } : {}) };
        $vars.$allTemplates = [...templates, tpl];
      }
      const instanceId = `synth_inst_${Math.random().toString(36).slice(2, 8)}`;
      const fields = {};
      if (cfg.date?.fieldId) {
        const dv = resolveExpr(cfg.date.value, $vars) ?? resolveExpr("$today", $vars);
        if (dv) fields[cfg.date.fieldId] = { value: dv, flow: "in" };
      }
      if (cfg.fields) {
        for (const [fid, expr] of Object.entries(cfg.fields)) {
          const v = resolveExpr(expr, $vars);
          if (v != null) fields[fid] = { value: v, flow: "in" };
        }
      }
      const parentId = resolveExpr(cfg.parent, $vars) ?? null;
      const instance = {
        id: instanceId, targetType: "module", targetId: templateId,
        templateId, parentId, fields, label: name, name, _ancestors: [],
        meta: cfg.meta || {},
      };
      if (Array.isArray($vars.$allItems)) $vars.$allItems = [...$vars.$allItems, instance];
      if (cfg.itemIdVar) $vars[cfg.itemIdVar] = instanceId;
      if (cfg.itemVar) $vars[cfg.itemVar] = instance;
      updates.push({ _effect: "CREATE_ITEM", templateId, instanceId, parentId });
      break;
    }

    case "UPDATE": {
      // Path-routed write: log a synthetic effect by path head.
      const path = typeof cfg.path === "string" && cfg.path.includes("${")
        ? cfg.path.replace(/\$\{([^}]+)\}/g, (_, inner) => {
            const v = resolveExpr(inner.trim(), $vars);
            return v != null ? String(v) : "";
          })
        : cfg.path;
      if (!path) break;
      const segs = path.split(".");
      const head = segs[0];
      const value = resolveExpr(cfg.value, $vars);
      let kind = "UPDATE_UNKNOWN";
      if (head === "$item") {
        if (segs[1] === "fields") kind = "UPDATE_ITEM_FIELD";
        else if (segs[1] === "parentId") kind = "UPDATE_ITEM_PARENT";
        else if (segs[1] === "meta") kind = "UPDATE_ITEM_META";
        else if (segs[1] === "textmap") kind = "UPDATE_ITEM_TEXTMAP";
      } else if (head === "$display") {
        kind = "UPDATE_DISPLAY_VALUE";
      } else if (segs.length === 1 && head.startsWith("$")) {
        // single-segment var write — pipeline-internal, no effect
        $vars[head] = value;
        break;
      }
      updates.push({ _effect: kind, path, value });
      break;
    }

    case "DELETE": {
      const itemId = resolveExpr(cfg.itemIdExpr, $vars);
      if (itemId) updates.push({ _effect: "DELETE_ITEM", itemId });
      break;
    }

    default:
      updates.push({ _effect: `unhandled:${type}` });
  }
  return updates;
}

function executeSteps(steps, $vars, ctx) {
  const updates = [];
  for (const step of steps || []) {
    if (step.type === "action") {
      updates.push(...executeActionItem(step.config?.type || step.actionType, step.config || {}, $vars, ctx));
    } else if (step.type === "if") {
      const branch = evalGroup(step.condition || { operator: "AND", rules: step.rules || [] }, $vars);
      updates.push(...executeSteps(branch ? step.then || [] : step.else || [], $vars, ctx));
    } else if (step.type === "loop") {
      const arr = resolveExpr(step.overExpr, $vars);
      const items = Array.isArray(arr) ? arr : [];
      const varName = step.as || "$item";
      for (const it of items) {
        $vars[varName] = it;
        updates.push(...executeSteps(step.body || [], $vars, ctx));
      }
      delete $vars[varName];
    }
  }
  return updates;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const user = await User.findOne({ email: "josh@jpoms.com" });
  const grid = await Grid.findOne({ userId: user._id.toString(), name: "Test Grid" }).sort({ _id: -1 });
  const gridId = grid._id.toString();

  const op = await Operation.findOne({ gridId, name: "Schedule: Build Day" });
  if (!op) {
    console.error('No operation named "Schedule: Build Day" found on this grid.');
    process.exit(1);
  }
  const allTemplates = (await Module.find({ gridId }).lean()).map(m => ({ ...m }));
  const allOccurrences = (await Occurrence.find({ gridId }).lean()).map(o => ({ ...o }));
  const tplById = Object.fromEntries(allTemplates.map(t => [t.id, t]));
  const allItems = allOccurrences.map(o => {
    const tpl = o.targetId ? tplById[o.targetId] : null;
    return {
      ...o,
      label: o.label ?? tpl?.label ?? tpl?.name ?? null,
      name: o.name ?? tpl?.name ?? tpl?.label ?? null,
      role: o.role ?? tpl?.role ?? null,
      kind: o.kind ?? tpl?.kind ?? null,
      meta: { ...(tpl?.meta || {}), ...(o.meta || {}) },
      templateId: o.targetId ?? null,
      _ancestors: [],
    };
  });

  const today = new Date().toISOString().slice(0, 10);
  const overrideDate = process.argv[2] || null;

  if (overrideDate) {
    const sched = allTemplates.find(m => m.label === "Schedule");
    const schedItem = allItems.find(o => o.targetId === sched?.id);
    if (schedItem) {
      const dateField = (await Field.find({ gridId, name: "Date" }).lean())[0];
      if (dateField) schedItem.filterOverride = { [dateField.id]: overrideDate };
    }
  }

  const $vars = {
    $today: today,
    $activeDate: overrideDate || today,
    $schedDate: overrideDate || today,
    $triggerDate: overrideDate || null,
    $allItems: allItems,
    $allTemplates: allTemplates,
    $trigger: { type: overrideDate ? "NavigationOp" : "onLoad" },
  };
  const ctx = {};

  console.log(`[before] today=${today}, overrideDate=${overrideDate || "(none)"}, $schedDate=${$vars.$schedDate}`);
  console.log(`[before] templates=${allTemplates.length}, items=${allItems.length}`);
  console.log(`[before] slot items =`, allItems.filter(o => o.meta?.scheduleSlot).length);

  const updates = executeSteps(op.pipeline.steps, $vars, ctx);

  const counts = updates.reduce((acc, u) => {
    acc[u._effect] = (acc[u._effect] || 0) + 1;
    return acc;
  }, {});
  console.log("\n[effects emitted]", counts);

  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
