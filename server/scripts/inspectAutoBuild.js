// scripts/inspectAutoBuild.js
// Dry-run the Schedule Auto-Build operation against the live test grid in Mongo
// without touching the React/sonner-coupled client executor. Counts how many
// effects each major step would produce so we can verify the new arrayOf-driven
// slot loop generates 48 CREATE_OCCURRENCE_FOR_MODULE effects on a fresh date.

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
  if (expr.startsWith("literal:")) return expr.slice(8);
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
  const { allModules, allOccurrencesArr } = ctx;
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
    case "INCREMENT_VAR": {
      const by = Number(cfg.by ?? 1);
      $vars[cfg.name] = (Number($vars[cfg.name]) || 0) + by;
      break;
    }
    case "FIND_MODULE": {
      const name = resolveExpr(cfg.nameExpr, $vars);
      const found = allModules.find(m => m.label === name || m.name === name);
      $vars[cfg.resultVar || "$foundModule"] = found || null;
      $vars[cfg.resultIdVar || "$foundModuleId"] = found?.id || null;
      break;
    }
    case "FIND_OCCURRENCE": {
      const targetId = resolveExpr(cfg.targetIdExpr, $vars);
      const moduleLabel = resolveExpr(cfg.moduleLabelExpr, $vars) || cfg.moduleLabel;
      let effectiveTargetIds = [];
      if (targetId) effectiveTargetIds = [targetId];
      else if (moduleLabel) {
        const mod = allModules.find(m => (m.label || m.name)?.toLowerCase() === moduleLabel.toLowerCase());
        if (mod) effectiveTargetIds = [mod.id];
      } else if (cfg.moduleMetaKey) {
        const metaValue = resolveExpr(cfg.moduleMetaValue, $vars);
        const matches = allModules.filter(m => String(m.meta?.[cfg.moduleMetaKey]) === String(metaValue));
        effectiveTargetIds = matches.map(m => m.id);
      }
      let found = null;
      if (effectiveTargetIds.length) {
        const candidates = allOccurrencesArr.filter(o =>
          effectiveTargetIds.includes(o.targetId) && !o.deleted && !o.meta?.isTemplate
        );
        if (cfg.dateFieldId) {
          const targetDate = resolveExpr(cfg.dateExpr, $vars);
          const dayKey = v => {
            if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
            const d = new Date(v);
            return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
          };
          const tk = dayKey(targetDate);
          if (tk) {
            found = candidates.find(o => {
              const fv = o.fields?.[cfg.dateFieldId];
              const v = fv?.value ?? fv;
              return dayKey(v) === tk;
            }) || null;
          }
        } else {
          found = candidates[0] || null;
        }
      }
      $vars[cfg.resultVar || "$foundOccurrence"] = found || null;
      $vars[cfg.resultIdVar || "$foundOccurrenceId"] = found?.id || null;
      break;
    }
    case "CREATE_MODULE": {
      const name = resolveExpr(cfg.nameExpr, $vars);
      const moduleId = `synth_mod_${Math.random().toString(36).slice(2, 8)}`;
      const occurrenceId = `synth_occ_${Math.random().toString(36).slice(2, 8)}`;
      $vars.$lastCreatedModuleId = moduleId;
      $vars.$lastCreatedOccurrenceId = occurrenceId;
      const stub = { id: moduleId, label: name, role: cfg.role, kind: cfg.kind, meta: cfg.extra?.meta || {} };
      ctx.allModules.push(stub);
      updates.push({ _effect: "CREATE_MODULE", moduleId, name });
      break;
    }
    case "CREATE_OCCURRENCE_FOR_MODULE": {
      const moduleId = resolveExpr(cfg.moduleIdExpr || cfg.moduleId, $vars);
      if (!moduleId) break;
      const occurrenceId = `synth_occ_${Math.random().toString(36).slice(2, 8)}`;
      const fields = {};
      if (cfg.dateFieldId) {
        const dateVal = resolveExpr(cfg.dateExpr, $vars) || resolveExpr("$today", $vars);
        if (dateVal) fields[cfg.dateFieldId] = { value: dateVal, flow: "in" };
      }
      const parentId = resolveExpr(cfg.parentIdExpr || cfg.parentId, $vars) || null;
      $vars[cfg.resultVar || "$foundOccurrence"] = { id: occurrenceId };
      $vars[cfg.resultIdVar || "$lastCreatedOccurrenceId"] = occurrenceId;
      const stub = { id: occurrenceId, targetType: "module", targetId: moduleId, parentId, fields };
      ctx.allOccurrencesArr.push(stub);
      updates.push({ _effect: "CREATE_OCCURRENCE_FOR_MODULE", occurrenceId, moduleId, parentId });
      break;
    }
    case "SET_FIELD_VALUE": {
      const occurrenceId = resolveExpr(cfg.occurrenceIdExpr, $vars);
      const value = cfg.value !== undefined ? cfg.value : resolveExpr(cfg.valueExpr, $vars);
      updates.push({ _effect: "SET_FIELD_VALUE", occurrenceId, fieldId: cfg.fieldId, value });
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
      const items = Array.isArray(resolveExpr(step.overExpr, $vars)) ? resolveExpr(step.overExpr, $vars) : [];
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
  // Find the MOST RECENT Test Grid (older runs leave stale grids around)
  const grid = await Grid.findOne({ userId: user._id.toString(), name: "Test Grid" }).sort({ _id: -1 });
  const gridId = grid._id.toString();

  const op = await Operation.findOne({ gridId, name: "Schedule: Auto-Build for Active Date" });
  const allModules = (await Module.find({ gridId }).lean()).map(m => ({ ...m }));
  const allOccurrencesArr = (await Occurrence.find({ gridId }).lean()).map(o => ({ ...o }));

  const today = new Date().toISOString().slice(0, 10);
  // Optional CLI arg: override date (simulates LocalFilterNav setting filterOverride)
  const overrideDate = process.argv[2] || null;

  // If overrideDate is set, also stamp it on the schedule page's filterOverride
  // so the operation's $schedPage.filterOverride.<dateFieldId> step picks it up.
  if (overrideDate) {
    const sched = allModules.find(m => m.label === "Schedule");
    const schedOcc = allOccurrencesArr.find(o => o.targetId === sched?.id);
    if (schedOcc) {
      const dateField = (await Field.find({ gridId, name: "Date" }).lean())[0];
      if (dateField) schedOcc.filterOverride = { [dateField.id]: overrideDate };
    }
  }

  const $vars = {
    $today: today,
    $activeDate: overrideDate || today,
    $allModules: allModules,
    $allOccurrences: allOccurrencesArr,
    $trigger: { type: overrideDate ? "NavigationOp" : "onLoad" },
  };
  const ctx = { allModules, allOccurrencesArr };

  console.log(`[before] today=${today}, overrideDate=${overrideDate || "(none)"}, $activeDate=${$vars.$activeDate}`);
  console.log(`[before] modules=${allModules.length}, occurrences=${allOccurrencesArr.length}`);
  console.log(`[before] slot occurrences =`, allOccurrencesArr.filter(o => allModules.find(m => m.id === o.targetId)?.meta?.scheduleSlot).length);

  const updates = executeSteps(op.pipeline.steps, $vars, ctx);

  const counts = updates.reduce((acc, u) => {
    acc[u._effect] = (acc[u._effect] || 0) + 1;
    return acc;
  }, {});
  console.log("\n[effects emitted]", counts);
  console.log(`[after] $activeDate (after pipeline) = ${$vars.$activeDate}`);
  console.log(`[after] $slotsCreated=${$vars.$slotsCreated}`);

  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
