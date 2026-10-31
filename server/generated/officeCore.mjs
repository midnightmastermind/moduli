// ../server/utils/matchesPattern.js
var cache = /* @__PURE__ */ new Map();
var CACHE_MAX = 500;
function compilePattern(spec) {
  if (spec instanceof RegExp) return spec;
  const s = spec == null ? "" : String(spec);
  if (!s) return null;
  if (cache.has(s)) return cache.get(s);
  let re = null;
  try {
    const m = /^\/([\s\S]+)\/([dgimsuy]*)$/.exec(s);
    re = m ? new RegExp(m[1], m[2].replace(/g|y/g, "")) : new RegExp(s, "i");
  } catch {
    re = null;
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(s, re);
  return re;
}
function matchesPattern(left, right) {
  const re = compilePattern(right);
  if (!re) return false;
  if (Array.isArray(left)) return left.some((v) => v != null && re.test(String(v)));
  if (left == null || left === "") return false;
  return re.test(String(left));
}

// src/helpers/dueSpan.js
function dayKey(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m2 = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m2}-${d}`;
  }
  const s = String(value).trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
}

// src/helpers/when.js
var WHEN_UNITS = ["minute", "hour", "day", "week", "month"];
var pad = (n) => String(n).padStart(2, "0");
var dayKey2 = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
var parseDay = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
var parseTime = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ""));
  return m ? { h: Number(m[1]), m: Number(m[2]) } : null;
};
var at = (day, time) => {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const t = parseTime(time);
  if (t) d.setHours(t.h, t.m, 0, 0);
  return d;
};
var DAY_MS = 864e5;
var daysBetween = (a, b) => Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS);
function onceDates(v) {
  const all = [...Array.isArray(v?.dates) ? v.dates : [], ...v?.date ? [v.date] : []].map(parseDay).filter(Boolean).map(dayKey2);
  return [...new Set(all)].sort();
}
function isWhen(v) {
  if (!v || typeof v !== "object") return false;
  if (v.mode === "once") return onceDates(v).length > 0;
  if (v.mode === "every") return WHEN_UNITS.includes(v.unit) && Number(v.every) >= 1 && !!parseDay(v.start?.date);
  if (v.mode === "weekdays") return Array.isArray(v.days) && v.days.length > 0;
  return false;
}
function whenTimesOnDay(v, day) {
  if (!isWhen(v)) return [];
  const d = typeof day === "string" ? parseDay(day) : day;
  if (!d) return [];
  const key = dayKey2(d);
  if (v.mode === "once") return onceDates(v).includes(key) ? [v.time || null] : [];
  if (v.mode === "weekdays") {
    const start2 = parseDay(v.start?.date);
    if (start2 && daysBetween(start2, d) < 0) return [];
    return v.days.map(Number).includes(d.getDay()) ? [v.time || null] : [];
  }
  const start = parseDay(v.start.date);
  const n = Math.max(1, Math.floor(Number(v.every)));
  const delta = daysBetween(start, d);
  if (delta < 0) return [];
  const time = v.start.time || null;
  if (v.unit === "day") return delta % n === 0 ? [time] : [];
  if (v.unit === "week") return delta % (7 * n) === 0 ? [time] : [];
  if (v.unit === "month") {
    const months = (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth());
    return months % n === 0 && d.getDate() === start.getDate() ? [time] : [];
  }
  const stepMs = n * (v.unit === "hour" ? 36e5 : 6e4);
  const first = at(start, time || "00:00").getTime();
  const dayStart = at(d, "00:00").getTime();
  const dayEnd = dayStart + DAY_MS;
  let k = Math.max(0, Math.ceil((dayStart - first) / stepMs));
  const out = [];
  for (let t = first + k * stepMs; t < dayEnd && out.length < 1440; t = first + ++k * stepMs) {
    const x = new Date(t);
    out.push(`${pad(x.getHours())}:${pad(x.getMinutes())}`);
  }
  return out;
}
var whenOnDay = (v, day) => whenTimesOnDay(v, day).length > 0;

// src/helpers/dragHitTesting.js
var DROP_TARGET_KIND = Object.freeze({
  OCCURRENCE: "occurrence",
  GRID_CELL: "grid-cell",
  DOC_CURSOR: "doc-cursor"
});
function buildParentsMap(occurrencesById) {
  const map = /* @__PURE__ */ Object.create(null);
  for (const occ of Object.values(occurrencesById || {})) {
    if (!Array.isArray(occ?.occurrences)) continue;
    for (const childId of occ.occurrences) {
      if (!childId) continue;
      (map[childId] ||= []).push(occ.id);
    }
  }
  return map;
}
var _parentsMapCache = /* @__PURE__ */ new WeakMap();
function cachedParentsMap(occurrencesById) {
  if (!occurrencesById || typeof occurrencesById !== "object") return /* @__PURE__ */ Object.create(null);
  const hit = _parentsMapCache.get(occurrencesById);
  if (hit) return hit;
  const map = buildParentsMap(occurrencesById);
  _parentsMapCache.set(occurrencesById, map);
  return map;
}
var _ancestorsCache = /* @__PURE__ */ new WeakMap();
function cachedAncestorsOf(occurrencesById) {
  if (!occurrencesById || typeof occurrencesById !== "object") {
    return (id) => reachableAncestors(id, occurrencesById, null);
  }
  let entry = _ancestorsCache.get(occurrencesById);
  if (!entry) {
    entry = { parents: cachedParentsMap(occurrencesById), byId: /* @__PURE__ */ new Map() };
    _ancestorsCache.set(occurrencesById, entry);
  }
  return (id) => {
    let hit = entry.byId.get(id);
    if (hit === void 0) {
      hit = reachableAncestors(id, occurrencesById, entry.parents);
      entry.byId.set(id, hit);
    }
    return hit;
  };
}
function reachableAncestors(id, occurrencesById, parentsMap) {
  const parents = parentsMap || buildParentsMap(occurrencesById);
  const out = [];
  const seen = /* @__PURE__ */ new Set([id]);
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift();
    const listed = parents[cur] || [];
    const own = occurrencesById?.[cur]?.parentId;
    const ups = own && !listed.includes(own) ? [...listed, own] : listed;
    for (const p of ups) {
      if (!p || seen.has(p)) continue;
      seen.add(p);
      out.push(p);
      queue.push(p);
    }
  }
  return out;
}

// src/state/notificationStore.js
var MAX_HISTORY = 100;
var _nextId = 1;
var _items = [];
var _subs = /* @__PURE__ */ new Set();
var _timers = /* @__PURE__ */ new Map();
var _emit = () => {
  for (const fn of _subs) fn(_items);
};
function _clearTimer(id) {
  const t = _timers.get(id);
  if (t) {
    clearTimeout(t);
    _timers.delete(id);
  }
}
function _scheduleDismiss(id, duration) {
  _clearTimer(id);
  if (typeof duration === "number" && duration > 0) {
    _timers.set(id, setTimeout(() => dismissTxNotification(id), duration));
  }
}
function pushTxNotification({ kind = "info", label, id = null, duration = null, detail = null }) {
  if (!label) return null;
  if (id != null && _items.some((n) => n.id === id)) {
    _items = _items.map((n) => n.id === id ? { ...n, kind, label, ...detail ? { detail } : {} } : n);
    _emit();
    _scheduleDismiss(id, duration);
    return id;
  }
  const newId = id != null ? id : `tx-note-${_nextId++}`;
  _items = [{ id: newId, kind, label, detail, createdAt: Date.now(), dismissed: false }, ..._items];
  if (_items.length > MAX_HISTORY) _items = _items.slice(0, MAX_HISTORY);
  _emit();
  _scheduleDismiss(newId, duration);
  return newId;
}
function dismissTxNotification(id) {
  _clearTimer(id);
  let changed = false;
  _items = _items.map((n) => {
    if (n.id === id && !n.dismissed) {
      changed = true;
      return { ...n, dismissed: true };
    }
    return n;
  });
  if (changed) _emit();
}
var DEFAULT_TOAST_DURATION = 4e3;
function _toast(kind, defaultDuration) {
  return (label, opts = {}) => {
    const text = opts.description ? `${label} \u2014 ${opts.description}` : label;
    const duration = "duration" in opts ? opts.duration : defaultDuration;
    return pushTxNotification({ kind, label: text, id: opts.id ?? null, duration });
  };
}
var toast = Object.assign(_toast("info", DEFAULT_TOAST_DURATION), {
  success: _toast("success", DEFAULT_TOAST_DURATION),
  error: _toast("error", DEFAULT_TOAST_DURATION),
  info: _toast("info", DEFAULT_TOAST_DURATION),
  message: _toast("info", DEFAULT_TOAST_DURATION),
  warning: _toast("warning", DEFAULT_TOAST_DURATION),
  loading: _toast("pending", null),
  // persists until updated via { id }
  dismiss: (id) => dismissTxNotification(id)
});

// src/helpers/bootSnapshot.js
var SNAPSHOT_MAX_AGE_MS = 7 * 24 * 3600 * 1e3;

// src/helpers/fileRef.js
var DRIVE_REF = /^gdrive:([^:]+):([^:]+)$/;
function resolveFileRef(fileRef) {
  if (!fileRef) return null;
  const drive = DRIVE_REF.exec(fileRef);
  if (drive) return `/files/${encodeURIComponent(drive[1])}/${encodeURIComponent(drive[2])}`;
  if (/^(?:https?:|data:|blob:|\/)/i.test(fileRef)) return fileRef;
  return `/uploads/${fileRef}`;
}

// src/helpers/mainFile.js
function valueArray(fieldValue) {
  if (Array.isArray(fieldValue)) return fieldValue;
  const v = fieldValue?.value;
  if (Array.isArray(v)) return v;
  return v ? [v] : [];
}
function resolveMainFile(fieldValue) {
  const main = !fieldValue || Array.isArray(fieldValue) ? null : fieldValue.main;
  if (!main) return null;
  return valueArray(fieldValue).includes(main) ? main : null;
}

// src/helpers/occurrenceMedia.js
function bindingsOf(module) {
  return Array.isArray(module?.fieldBindings) ? module.fieldBindings : [];
}
function fieldIdForRole(module, role) {
  return bindingsOf(module).find((b) => b?.role === role)?.fieldId ?? null;
}
function mediaFieldIdFor(module) {
  return fieldIdForRole(module, "media");
}
function filesFieldIdFor(module) {
  return fieldIdForRole(module, "files");
}
function rawValue(occ, fieldId) {
  if (!fieldId) return void 0;
  const v = occ?.fields?.[fieldId];
  if (v && typeof v === "object" && !Array.isArray(v)) return "value" in v ? v.value : void 0;
  return v;
}
function idsFrom(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string" && v);
  return typeof value === "string" && value ? [value] : [];
}
function resolveArtifact(id, ctx) {
  const occ = ctx?.occurrencesById?.[id];
  if (!occ) return null;
  const module = ctx?.modulesById?.[occ.moduleId];
  if (!module || module.role !== "artifact") return null;
  return {
    occ,
    module,
    kind: module.kind || null,
    src: resolveFileRef(module.fileRef),
    label: occ.label || module.label || ""
  };
}
function primaryMediaOf(occ, ctx) {
  const module = ctx?.modulesById?.[occ?.moduleId];
  const mainId = resolveMainFile(occ?.fields?.[filesFieldIdFor(module)]);
  const fromMain = mainId ? resolveArtifact(mainId, ctx) : null;
  if (fromMain) return fromMain;
  const [id] = idsFrom(rawValue(occ, mediaFieldIdFor(module)));
  return id ? resolveArtifact(id, ctx) : null;
}
function filesOf(occ, ctx) {
  const module = ctx?.modulesById?.[occ?.moduleId];
  const primaryId = idsFrom(rawValue(occ, mediaFieldIdFor(module)))[0] || null;
  const attachedIds = idsFrom(rawValue(occ, filesFieldIdFor(module)));
  const childIds = Array.isArray(occ?.occurrences) ? occ.occurrences : [];
  const ordered = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (id, source) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const resolved = resolveArtifact(id, ctx);
    if (resolved) ordered.push({ ...resolved, source, isPrimary: id === primaryId });
  };
  const selfArtifact = resolveArtifact(occ?.id, ctx);
  const others = [primaryId, ...attachedIds, ...childIds].filter((id) => id && id !== occ?.id).map((id) => resolveArtifact(id, ctx)).filter(Boolean);
  const othersExist = others.length > 0;
  const coverRef = occ?.meta?.cover || selfArtifact?.module?.meta?.cover || null;
  const coverSrc = coverRef ? resolveFileRef(coverRef) : null;
  const coverIsOnlyPicture = !!coverSrc && !others.some((a) => a.src && a.src === coverSrc);
  if (selfArtifact && (selfArtifact.src || !othersExist || coverIsOnlyPicture)) push(occ?.id, "self");
  if (primaryId) push(primaryId, attachedIds.includes(primaryId) ? "field" : "child");
  for (const id of attachedIds) push(id, "field");
  for (const id of childIds) push(id, "child");
  return ordered;
}

// src/helpers/operationActions.js
function parseLocalDate(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [y, m, day] = value.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, day);
  }
  return new Date(value);
}
var _pathParts = /* @__PURE__ */ new Map();
function partsOf(expr) {
  let p = _pathParts.get(expr);
  if (p === void 0) {
    if (_pathParts.size > 5e3) _pathParts.clear();
    p = expr.slice(1).split(".");
    _pathParts.set(expr, p);
  }
  return p;
}
function walkVarPath(expr, $vars) {
  const parts = partsOf(expr);
  let cur = $vars[`$${parts[0]}`];
  if (cur == null) return null;
  for (let i = 1; i < parts.length; i++) {
    if (cur == null) return null;
    cur = cur[parts[i]];
  }
  return cur ?? null;
}
function resolveExpr(expr, $vars) {
  if (expr == null) return null;
  if (typeof expr === "object" && !Array.isArray(expr) && expr !== null && Object.prototype.hasOwnProperty.call(expr, "__ref")) {
    return expr.__ref ? resolveExpr(expr.__ref, $vars) : null;
  }
  if (typeof expr !== "string") return expr;
  if (expr === "") return null;
  const c0 = expr.charCodeAt(0);
  if (c0 === 36) {
    if (expr.indexOf("${") < 0) return walkVarPath(expr, $vars);
  } else if (expr.indexOf(":") < 0 && expr.indexOf("${") < 0) {
    return expr;
  }
  if (expr.startsWith("literal:")) {
    const raw = expr.slice(8);
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (raw === "null") return null;
    if (raw !== "" && !isNaN(Number(raw)) && /^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    return raw;
  }
  if (expr.startsWith("json:")) {
    let parsed;
    try {
      parsed = JSON.parse(expr.slice(5));
    } catch {
      return null;
    }
    const varLeaves = (v) => {
      if (typeof v === "string") {
        if (!v.startsWith("$")) return v;
        const r = resolveExpr(v, $vars);
        if (r !== void 0 && r !== null) return r;
        const root = v.match(/^\$[A-Za-z_][A-Za-z0-9_]*/)?.[0];
        return root && root in $vars ? null : v;
      }
      if (Array.isArray(v)) return v.map(varLeaves);
      if (v && typeof v === "object") {
        const o = {};
        for (const [k, x] of Object.entries(v)) o[k] = varLeaves(x);
        return o;
      }
      return v;
    };
    return varLeaves(parsed);
  }
  if (expr.startsWith("occ:")) {
    const rest = expr.slice(4);
    const parts = rest.split(".");
    let occId;
    let startIdx;
    if (parts[0].startsWith("$")) {
      const innerExpr = `${parts[0]}.${parts[1]}`;
      occId = resolveExpr(innerExpr, $vars);
      startIdx = 2;
    } else {
      occId = parts[0];
      startIdx = 1;
    }
    if (!occId) return null;
    const fieldId = parts[startIdx];
    const prop = parts[startIdx + 1] || "value";
    if (!fieldId) return null;
    const occurrencesById = $vars["_occurrencesById"] || {};
    const occ = occurrencesById[occId];
    const fv = occ?.fields?.[fieldId];
    if (fv === void 0 || fv === null) return null;
    if (prop === "flow") return fv.flow ?? null;
    return fv.value !== void 0 ? fv.value : fv;
  }
  if (expr.startsWith("field:")) {
    const rest = expr.slice(6);
    const [fieldId, prop = "value"] = rest.split(".");
    if (!fieldId) return null;
    const occurrencesById = $vars["_occurrencesById"] || {};
    for (const occ of Object.values(occurrencesById)) {
      const fv = occ?.fields?.[fieldId];
      if (fv !== void 0 && fv !== null) {
        if (prop === "flow") return fv.flow ?? null;
        return fv.value !== void 0 ? fv.value : fv;
      }
    }
    return null;
  }
  if (expr.startsWith("daysUntil:")) {
    const dateVal = resolveExpr(expr.slice(10), $vars);
    if (!dateVal) return null;
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return null;
    const today = /* @__PURE__ */ new Date();
    today.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    return Math.round((d - today) / 864e5);
  }
  if (expr.startsWith("weekday:")) {
    const dateVal = resolveExpr(expr.slice(8), $vars);
    if (dateVal == null || dateVal === "") return "";
    const d = parseLocalDate(dateVal);
    if (!d || isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-US", { weekday: "long" });
  }
  if (expr.startsWith("dateLong:")) {
    const dateVal = resolveExpr(expr.slice(9), $vars);
    if (dateVal == null || dateVal === "") return "";
    const d = parseLocalDate(dateVal);
    if (!d || isNaN(d.getTime())) return String(dateVal);
    const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
    const month = d.toLocaleDateString("en-US", { month: "long" });
    const dayNum = d.getDate();
    const j = dayNum % 10, k = dayNum % 100;
    const suffix = k >= 11 && k <= 13 ? "th" : j === 1 ? "st" : j === 2 ? "nd" : j === 3 ? "rd" : "th";
    return `${weekday}, ${month} ${dayNum}${suffix}, ${d.getFullYear()}`;
  }
  if (expr.includes("${")) {
    const substituted = expr.replace(/\$\{([^}]+)\}/g, (_, inner) => {
      const resolved = resolveExpr(inner.trim(), $vars);
      return resolved != null ? String(resolved) : "";
    });
    if (substituted.startsWith("$")) return resolveExpr(substituted, $vars);
    return substituted;
  }
  if (expr.startsWith("$")) return walkVarPath(expr, $vars);
  return expr;
}
var arrayIncludes = (arr, val) => arr.some((a) => String(a) === String(val));
var dayKeyOf = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
var todayKey = () => dayKeyOf(/* @__PURE__ */ new Date());
function evalRule(rule, $vars) {
  const { left, comparator, right } = rule;
  const leftVal = resolveExpr(left, $vars);
  const isEmptyVal = leftVal === null || leftVal === void 0 || leftVal === "" || Array.isArray(leftVal) && leftVal.length === 0;
  if (comparator === "IS_EMPTY") return isEmptyVal;
  if (comparator === "IS_NOT_EMPTY") return !isEmptyVal;
  const rightVal = resolveExpr(right, $vars) ?? right;
  switch (comparator) {
    case "IS":
      return String(leftVal) === String(rightVal);
    case "IS_NOT":
      return String(leftVal) !== String(rightVal);
    // Numeric comparators. The `_THAN` aliases match the natural-language
    // phrasing seed authors reach for ("$count GREATER_THAN 0") — without
    // them, a hand-typed predicate silently falls through to the default
    // `return false`, making a guard's whole AND branch dead code. Aliased
    // here so authoring stays forgiving on either name.
    case "GREATER":
    case "GREATER_THAN":
      return Number(leftVal) > Number(rightVal);
    case "LESS":
    case "LESS_THAN":
      return Number(leftVal) < Number(rightVal);
    case "GREATER_OR_EQUAL":
    case "GREATER_THAN_OR_EQUAL":
      return Number(leftVal) >= Number(rightVal);
    case "LESS_OR_EQUAL":
    case "LESS_THAN_OR_EQUAL":
      return Number(leftVal) <= Number(rightVal);
    // CONTAINS is array-aware: an array left (tags-style multi-value field)
    // matches by EXACT member equality (same semantic as ARRAY_INCLUDES) — a
    // stringified-substring test over a joined array gives false positives
    // ("art" would match ["smart"]). Strings keep substring semantics.
    case "CONTAINS":
      return Array.isArray(leftVal) ? arrayIncludes(leftVal, rightVal) : String(leftVal).includes(String(rightVal));
    case "NOT_CONTAINS":
      return Array.isArray(leftVal) ? !arrayIncludes(leftVal, rightVal) : !String(leftVal).includes(String(rightVal));
    // A regular expression: `/source/flags`, or plain text as a case-insensitive source
    // (server/utils/matchesPattern — the server executor shares it). An invalid pattern
    // matches nothing.
    case "MATCHES":
      return matchesPattern(leftVal, rightVal);
    case "NOT_MATCHES":
      return !matchesPattern(leftVal, rightVal);
    // Time-of-day comparators — generic, domain-agnostic. Parse BOTH 12h
    // ("9:00am", "9am", "12:30 PM") and 24h ("14:30", "09:00") forms, plus the
    // time portion of an ISO datetime, to minutes-since-midnight, then compare.
    // Either side unparseable → false (a time comparison against a non-time
    // never matches). Lets a pipeline ask "is this time-of-day field before
    // $currentTime?" without baking any time math into the seed.
    case "TIME_BEFORE":
    case "TIME_AFTER": {
      const toMin = (v) => {
        if (v == null) return null;
        const s = String(v).trim().toLowerCase();
        if (!s) return null;
        const m12 = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
        if (m12) {
          let h = parseInt(m12[1], 10);
          const min = m12[2] ? parseInt(m12[2], 10) : 0;
          if (h === 12) h = 0;
          if (m12[3] === "pm") h += 12;
          return h > 23 || min > 59 ? null : h * 60 + min;
        }
        const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
        if (m24) {
          const h = parseInt(m24[1], 10);
          const min = parseInt(m24[2], 10);
          return h > 23 || min > 59 ? null : h * 60 + min;
        }
        if (/^\d{4}-\d{2}-\d{2}t/.test(s)) {
          const d = new Date(v);
          if (!isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes();
        }
        return null;
      };
      const lm = toMin(leftVal);
      const rm = toMin(rightVal);
      if (lm == null || rm == null) return false;
      return comparator === "TIME_BEFORE" ? lm < rm : lm > rm;
    }
    // Calendar-day before/after — compares by day-key only (time of day
    // ignored). Either side null/""/unparseable → false. Lexical day-key
    // compare is correct date ordering; the regex slice avoids the timezone
    // shift `new Date("2026-06-03T..Z")` would introduce on a bare date.
    case "DATE_BEFORE":
    case "DATE_AFTER": {
      if (leftVal == null || leftVal === "" || rightVal == null || rightVal === "") return false;
      const dayKey3 = (v) => {
        if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
        const d = new Date(v);
        if (isNaN(d.getTime())) return null;
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      };
      const lk = dayKey3(leftVal);
      const rk = dayKey3(rightVal);
      if (lk == null || rk == null) return false;
      return comparator === "DATE_BEFORE" ? lk < rk : lk > rk;
    }
    // A date-time more than N minutes in the past (right = N). Empty or unparseable left -> false;
    // a bare date counts as its local midnight. For a mark that must expire when the run that
    // wrote it never finished (Day Page: Add Reading).
    case "OLDER_THAN_MINUTES": {
      if (leftVal == null || leftVal === "") return false;
      const mins = Number(rightVal);
      if (!Number.isFinite(mins)) return false;
      const t = typeof leftVal === "string" && /^\d{4}-\d{2}-\d{2}$/.test(leftVal) ? parseLocalDate(leftVal)?.getTime() : new Date(leftVal).getTime();
      if (!Number.isFinite(t)) return false;
      return Date.now() - t > mins * 6e4;
    }
    // Same words, ignoring case, accents, punctuation and spacing — how a
    // person's name is "the same". Twin of the server executor's SAME_TEXT.
    case "SAME_TEXT": {
      const fold = (v) => String(v ?? "").normalize("NFKC").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const a = fold(leftVal);
      return !!a && a === fold(rightVal);
    }
    // Array comparators — left resolves to an array (e.g. $item._ancestors)
    case "HAS_ANCESTOR":
    case "ARRAY_INCLUDES":
      return arrayIncludes(Array.isArray(leftVal) ? leftVal : [], rightVal);
    case "NOT_HAS_ANCESTOR":
    case "ARRAY_NOT_INCLUDES":
      return !arrayIncludes(Array.isArray(leftVal) ? leftVal : [], rightVal);
    // Two lists (or a list and one value) with at least one member in common — "the episode's Series is one
    // of the shows picked on this row". Either side may be a single value. An empty side shares nothing.
    case "SHARES_ANY": {
      const as = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]).map(String);
      const r = new Set(as(rightVal));
      return as(leftVal).some((a) => r.has(a));
    }
    // Date comparators — leftVal is a date field value (ISO string or Date)
    case "DATE_EQUALS":
    // A WHEN value (a date + time, or a repeat — helpers/when.js) that falls on the day on the right.
    case "WHEN_ON_DAY":
      return whenOnDay(leftVal, rightVal);
    case "SAME_DAY": {
      if (rightVal == null || rightVal === "") return true;
      if (leftVal == null || leftVal === "") return false;
      const lk = sameDayKey(leftVal);
      const rk = sameDayKey(rightVal);
      return lk != null && lk === rk;
    }
    case "SAME_WEEK": {
      if (rightVal == null || rightVal === "") return true;
      if (leftVal == null || leftVal === "") return false;
      const da = parseLocalDate(leftVal);
      const db = parseLocalDate(rightVal);
      if (!da || !db || isNaN(da.getTime()) || isNaN(db.getTime())) return false;
      const weekStart = (d) => {
        const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const dow = x.getDay();
        const offset = dow === 0 ? -6 : 1 - dow;
        x.setDate(x.getDate() + offset);
        return x.getTime();
      };
      return weekStart(da) === weekStart(db);
    }
    case "SAME_MONTH": {
      if (rightVal == null || rightVal === "") return true;
      if (leftVal == null || leftVal === "") return false;
      const da = parseLocalDate(leftVal);
      const db = parseLocalDate(rightVal);
      if (!da || !db || isNaN(da.getTime()) || isNaN(db.getTime())) return false;
      return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth();
    }
    case "SAME_YEAR": {
      if (rightVal == null || rightVal === "") return true;
      if (leftVal == null || leftVal === "") return false;
      const da = parseLocalDate(leftVal);
      const db = parseLocalDate(rightVal);
      if (!da || !db || isNaN(da.getTime()) || isNaN(db.getTime())) return false;
      return da.getFullYear() === db.getFullYear();
    }
    // ── DATE_ON_OR_BEFORE_PERIOD — the cut-off twin of DATE_IN_PERIOD ──────
    //
    // User, 2026-09-08: *"it would determine if its a current up through that
    // day we set or total for that day."*
    //
    // `DATE_IN_PERIOD` asks "did this happen IN VIEW", which is right for a sum
    // and wrong for a BALANCE: filtered to a quiet Tuesday a balance counted
    // nothing and reported 0 for an account that plainly held money, and
    // filtered to today it reported the day's CHANGE as the balance. A running
    // total wants everything up to and including the period's LAST day.
    //
    // It reads the SAME period shapes, so a tracker's own `$goalPeriod` works
    // unchanged — which matters, because the period a tile is filtered to is not
    // the period its operation's page is on, and reaching for the page's
    // `$activePeriodDates` instead answers the wrong question entirely.
    case "DATE_ON_OR_BEFORE_PERIOD": {
      if (rightVal == null || rightVal === "") return true;
      if (leftVal == null || leftVal === "") return false;
      const dayKey3 = (v) => {
        if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
        const d = new Date(v);
        if (isNaN(d.getTime())) return null;
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      };
      const lk = dayKey3(leftVal);
      if (lk == null) return false;
      const isObj = typeof rightVal === "object" && !Array.isArray(rightVal);
      if (isObj && rightVal.kind === "multi" && Array.isArray(rightVal.dates)) {
        const keys = rightVal.dates.map(dayKey3).filter(Boolean).sort();
        if (!keys.length) return true;
        return lk <= keys[keys.length - 1];
      }
      const anchor = isObj ? rightVal.value : rightVal;
      if (anchor == null || anchor === "") return true;
      const ak = dayKey3(anchor);
      if (ak == null) return false;
      const unit = isObj ? rightVal.unit || "day" : "day";
      const spanRaw = isObj ? Number(rightVal.span) : 1;
      const span = Number.isFinite(spanRaw) && spanRaw > 1 ? Math.floor(spanRaw) : 1;
      const [ay, am, ad] = ak.split("-").map(Number);
      const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      let end;
      if (unit === "week") {
        const x = new Date(ay, am - 1, ad);
        const dow = x.getDay();
        x.setDate(x.getDate() + (dow === 0 ? 0 : 7 - dow));
        end = keyOf(x);
      } else if (unit === "month") {
        end = keyOf(new Date(ay, am, 0));
      } else if (unit === "year") {
        end = `${ay}-12-31`;
      } else {
        end = keyOf(new Date(ay, am - 1, ad + Math.max(1, span) - 1));
      }
      return lk <= end;
    }
    case "DATE_IN_PERIOD": {
      if (rightVal == null || rightVal === "") return true;
      if (leftVal == null || leftVal === "") return false;
      const isObj = typeof rightVal === "object" && !Array.isArray(rightVal);
      const dayKey3 = (v) => {
        if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
        const d = new Date(v);
        if (isNaN(d.getTime())) return null;
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      };
      if (isObj && rightVal.kind === "multi" && Array.isArray(rightVal.dates)) {
        const lk = dayKey3(leftVal);
        if (lk == null) return false;
        for (const ds of rightVal.dates) {
          const rk = dayKey3(ds);
          if (rk != null && rk === lk) return true;
        }
        return false;
      }
      const anchor = isObj ? rightVal.value : rightVal;
      const unit = isObj ? rightVal.unit || "day" : "day";
      const spanRaw = isObj ? Number(rightVal.span) : 1;
      const span = Number.isFinite(spanRaw) && spanRaw > 1 ? Math.floor(spanRaw) : 1;
      if (anchor == null || anchor === "") return true;
      if (unit === "day") {
        const lk = dayKey3(leftVal);
        const rk = dayKey3(anchor);
        if (lk == null || rk == null) return false;
        if (span <= 1) return lk === rk;
        const [ry, rm, rd] = rk.split("-").map(Number);
        const startMs = new Date(ry, rm - 1, rd).getTime();
        const [ly, lm, ld] = lk.split("-").map(Number);
        const leftMs = new Date(ly, lm - 1, ld).getTime();
        const dayMs = 24 * 60 * 60 * 1e3;
        const diffDays = Math.round((leftMs - startMs) / dayMs);
        return diffDays >= 0 && diffDays < span;
      }
      const localDate = (v) => {
        const k = dayKey3(v);
        if (!k) return null;
        const [yy, mm, dd] = k.split("-").map(Number);
        return new Date(yy, mm - 1, dd);
      };
      const da = localDate(leftVal);
      const db = localDate(anchor);
      if (!da || !db) return false;
      if (unit === "week") {
        const weekStart = (d) => {
          const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
          const dow = x.getDay();
          const offset = dow === 0 ? -6 : 1 - dow;
          x.setDate(x.getDate() + offset);
          return x.getTime();
        };
        return weekStart(da) === weekStart(db);
      }
      if (unit === "month") {
        return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth();
      }
      if (unit === "year") {
        return da.getFullYear() === db.getFullYear();
      }
      return false;
    }
    // The three partition the timeline: for any parseable day exactly one is
    // true. All read `dayKeyOf` so a bare "YYYY-MM-DD" is never re-parsed into
    // the previous local evening — see the helper's note.
    case "DATE_BEFORE_TODAY": {
      const k = dayKeyOf(leftVal);
      return k != null && k < todayKey();
    }
    case "DATE_IS_TODAY": {
      const k = dayKeyOf(leftVal);
      return k != null && k === todayKey();
    }
    case "DATE_AFTER_TODAY": {
      const k = dayKeyOf(leftVal);
      return k != null && k > todayKey();
    }
    case "DATE_WITHIN_DAYS": {
      if (!leftVal) return false;
      const d = new Date(leftVal);
      if (isNaN(d.getTime())) return false;
      d.setHours(0, 0, 0, 0);
      const today = /* @__PURE__ */ new Date();
      today.setHours(0, 0, 0, 0);
      const n = parseInt(rightVal) || 7;
      const diffDays = Math.round((d - today) / (1e3 * 60 * 60 * 24));
      return diffDays >= 0 && diffDays <= n;
    }
    default:
      return false;
  }
}
function sameDayKey(v) {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (v == null || v === "") return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function resolveRecordPath(record, path) {
  if (record == null || !path) return null;
  const normalized = path.startsWith("$item.") ? path.slice(6) : path.startsWith("$record.") ? path.slice(8) : path;
  const parts = String(normalized).split(".");
  let cur = record;
  for (const seg of parts) {
    if (cur == null) return null;
    cur = cur[seg];
  }
  return cur ?? null;
}
function evalRuleWithLeftValue(rule, leftVal, $vars) {
  const key = "$__find_left__";
  const prev = $vars[key];
  $vars[key] = leftVal;
  try {
    return evalRule({ ...rule, left: key }, $vars);
  } finally {
    $vars[key] = prev;
  }
}
var isVarLeft = (left) => typeof left === "string" && left.startsWith("$") && !/^\$(item|record)\./.test(left);
function evalRuleAgainstRecord(rule, record, $vars) {
  const leftVal = isVarLeft(rule.left) ? resolveExpr(rule.left, $vars) ?? null : resolveRecordPath(record, rule.left);
  return evalRuleWithLeftValue(rule, leftVal, $vars);
}
function evalGroupAgainstRecord(group, record, $vars) {
  const { operator = "AND", rules = [] } = group;
  if (rules.length === 0) return true;
  const evaluate = (entry) => {
    if (Array.isArray(entry?.rules)) return evalGroupAgainstRecord(entry, record, $vars);
    return evalRuleAgainstRecord(entry, record, $vars);
  };
  if (operator === "OR") return rules.some(evaluate);
  return rules.every(evaluate);
}

// src/helpers/feedTokens.js
var TOKENS = {
  // Matches the executor's `$today` exactly — a LOCAL day key, never
  // toISOString (which rolls a day at the UTC boundary).
  $today: (now) => dayKey(now)
};
function resolveFeedConditionValue(value, now = /* @__PURE__ */ new Date()) {
  if (typeof value !== "string") return value;
  const s = value.trim();
  if (s.charCodeAt(0) !== 36) return value;
  const resolve = Object.prototype.hasOwnProperty.call(TOKENS, s) ? TOKENS[s] : null;
  return resolve ? resolve(now) : value;
}

// src/helpers/comparators.js
var COMPARATOR_CATALOG = [
  // ── Value ───────────────────────────────────────────────────────────────
  { value: "IS", label: "is", group: "Value", simple: true },
  { value: "IS_NOT", label: "is not", group: "Value", simple: true },
  { value: "CONTAINS", label: "contains", group: "Value", simple: true },
  { value: "NOT_CONTAINS", label: "does not contain", group: "Value" },
  { value: "SAME_TEXT", label: "same text (ignores case, accents)", group: "Value", simple: true },
  { value: "MATCHES", label: "matches regex", group: "Value" },
  { value: "NOT_MATCHES", label: "does not match regex", group: "Value" },
  { value: "IS_EMPTY", label: "is empty", group: "Value", simple: true, unary: true },
  { value: "IS_NOT_EMPTY", label: "not empty", group: "Value", simple: true, unary: true },
  // ── Numbers ─────────────────────────────────────────────────────────────
  { value: "GREATER", label: ">", group: "Numbers", simple: true },
  { value: "LESS", label: "<", group: "Numbers", simple: true },
  { value: "GREATER_OR_EQUAL", label: ">=", group: "Numbers" },
  { value: "LESS_OR_EQUAL", label: "<=", group: "Numbers" },
  { value: "GREATER_THAN", label: ">", group: "Numbers", alias: true },
  { value: "LESS_THAN", label: "<", group: "Numbers", alias: true },
  { value: "GREATER_THAN_OR_EQUAL", label: ">=", group: "Numbers", alias: true },
  { value: "LESS_THAN_OR_EQUAL", label: "<=", group: "Numbers", alias: true },
  // ── Dates ───────────────────────────────────────────────────────────────
  { value: "SAME_DAY", label: "same day", group: "Dates", simple: true },
  { value: "SAME_WEEK", label: "same week", group: "Dates", simple: true },
  { value: "SAME_MONTH", label: "same month", group: "Dates", simple: true },
  { value: "SAME_YEAR", label: "same year", group: "Dates", simple: true },
  { value: "DATE_EQUALS", label: "date equals", group: "Dates" },
  { value: "DATE_BEFORE", label: "before date", group: "Dates" },
  { value: "DATE_AFTER", label: "after date", group: "Dates" },
  { value: "OLDER_THAN_MINUTES", label: "older than N minutes", group: "Dates" },
  { value: "DATE_IS_TODAY", label: "is today", group: "Dates", unary: true },
  { value: "DATE_BEFORE_TODAY", label: "before today", group: "Dates", unary: true },
  { value: "DATE_AFTER_TODAY", label: "after today", group: "Dates", unary: true },
  { value: "DATE_WITHIN_DAYS", label: "within N days", group: "Dates" },
  { value: "DATE_IN_PERIOD", label: "in the period", group: "Dates" },
  { value: "DATE_ON_OR_BEFORE_PERIOD", label: "on or before the period", group: "Dates" },
  { value: "WHEN_ON_DAY", label: "falls on the day", group: "Dates" },
  // ── Time of day ─────────────────────────────────────────────────────────
  { value: "TIME_BEFORE", label: "time before", group: "Time of day" },
  { value: "TIME_AFTER", label: "time after", group: "Time of day" },
  // ── Lists ───────────────────────────────────────────────────────────────
  { value: "ARRAY_INCLUDES", label: "list includes", group: "Lists" },
  { value: "ARRAY_NOT_INCLUDES", label: "list does not include", group: "Lists" },
  { value: "SHARES_ANY", label: "shares any with", group: "Lists" },
  // ── Structure ───────────────────────────────────────────────────────────
  { value: "HAS_ANCESTOR", label: "has ancestor", group: "Structure" },
  { value: "NOT_HAS_ANCESTOR", label: "does not have ancestor", group: "Structure" }
];
var SIMPLE_ORDER = [
  "SAME_DAY",
  "SAME_WEEK",
  "SAME_MONTH",
  "SAME_YEAR",
  "IS",
  "IS_NOT",
  "CONTAINS",
  "SAME_TEXT",
  "GREATER",
  "LESS",
  "IS_EMPTY",
  "IS_NOT_EMPTY"
];
var COMPARATOR_OPTIONS = SIMPLE_ORDER.map((v) => {
  const c = COMPARATOR_CATALOG.find((e) => e.value === v);
  return { value: c.value, label: c.label };
});
var UNARY_COMPARATORS = new Set(
  COMPARATOR_CATALOG.filter((c) => c.unary).map((c) => c.value)
);
var PIPELINE_COMPARATOR_GROUPS = (() => {
  const out = [];
  for (const c of COMPARATOR_CATALOG) {
    if (c.alias) continue;
    let g = out.find((o) => o.group === c.group);
    if (!g) {
      g = { group: c.group, items: [] };
      out.push(g);
    }
    g.items.push(c);
  }
  return out;
})();
var COMPARATOR_VALUES = new Set(COMPARATOR_CATALOG.map((c) => c.value));

// src/helpers/feedPredicate.js
var MAX_DEPTH = 4;
var RECORD_PATHS = /* @__PURE__ */ new Set(["_ancestors", "parentId"]);
var isGroup = (entry) => Array.isArray(entry?.conditions);
var normaliseOperator = (op) => String(op).toUpperCase() === "OR" ? "OR" : "AND";
function buildNode(entry, now, depth) {
  if (isGroup(entry)) {
    if (depth >= MAX_DEPTH) return null;
    const rules = [];
    for (const child of entry.conditions) {
      const node = buildNode(child, now, depth + 1);
      if (node) rules.push(node);
    }
    if (!rules.length) return null;
    return { operator: normaliseOperator(entry.operator), rules };
  }
  const path = RECORD_PATHS.has(entry?.path) ? entry.path : null;
  if (!entry?.fieldId && !path) return null;
  const comparator = entry.comparator || "IS";
  const v = entry.value;
  if (!UNARY_COMPARATORS.has(comparator) && (v == null || v === "" || Array.isArray(v) && !v.length)) return null;
  return {
    left: path || `fields.${entry.fieldId}.value`,
    comparator,
    right: resolveFeedConditionValue(entry.value, now)
  };
}
function buildFeedPredicate(feed, { now = /* @__PURE__ */ new Date() } = {}) {
  const conditions = Array.isArray(feed?.conditions) ? feed.conditions : [];
  if (!conditions.length) return null;
  const rules = [];
  for (const entry of conditions) {
    const node = buildNode(entry, now, 1);
    if (node) rules.push(node);
  }
  if (!rules.length) return null;
  return { operator: normaliseOperator(feed?.conditionOperator), rules };
}

// src/state/selectors.js
var _roleIndexCache = /* @__PURE__ */ new WeakMap();
function occurrencesByRole(occurrencesById, modulesById) {
  if (!occurrencesById || typeof occurrencesById !== "object") return /* @__PURE__ */ new Map();
  const hit = _roleIndexCache.get(occurrencesById);
  if (hit && hit.mods === modulesById) return hit.byRole;
  const byRole = /* @__PURE__ */ new Map();
  for (const occ of Object.values(occurrencesById)) {
    if (!occ?.id) continue;
    const role = occ.role ?? modulesById?.[occ.moduleId]?.role ?? null;
    if (role == null) continue;
    let arr = byRole.get(role);
    if (!arr) byRole.set(role, arr = []);
    arr.push(occ);
  }
  _roleIndexCache.set(occurrencesById, { mods: modulesById, byRole });
  return byRole;
}
function resolveFeedItems(feedOcc, { occurrencesById, modulesById } = {}) {
  const feed = feedOcc?.feed;
  if (!feed?.enabled || !occurrencesById) return [];
  const roles = Array.isArray(feed.roles) && feed.roles.length ? feed.roles : ["instance"];
  const limit = Number(feed.limit) > 0 ? Number(feed.limit) : 50;
  const ancestorsOf = cachedAncestorsOf(occurrencesById);
  const ownChain = /* @__PURE__ */ new Set([feedOcc.id, ...ancestorsOf(feedOcc.id)]);
  const predicate = buildFeedPredicate(feed, { now: /* @__PURE__ */ new Date() });
  const hasConditions = Array.isArray(feed.conditions) && feed.conditions.length > 0;
  if (!predicate && hasConditions && !feed.scope) return [];
  const candidates = roles.length === 1 ? occurrencesByRole(occurrencesById, modulesById).get(roles[0]) || [] : Object.values(occurrencesById);
  const needsRoleCheck = roles.length !== 1;
  const out = [];
  for (const occ of candidates) {
    if (!occ?.id || ownChain.has(occ.id)) continue;
    if (occ.meta?.feedSourceId) continue;
    if (feedOcc.gridId && occ.gridId && occ.gridId !== feedOcc.gridId) continue;
    const mod = modulesById?.[occ.moduleId];
    if (needsRoleCheck && !roles.includes(occ.role ?? mod?.role ?? null)) continue;
    const ancestors = ancestorsOf(occ.id);
    if (ancestors.includes(feedOcc.id)) continue;
    if (feed.scope && !ancestors.includes(feed.scope)) continue;
    if (predicate && !evalGroupAgainstRecord(predicate, { ...occ, _ancestors: ancestors }, {})) continue;
    out.push({ occurrence: occ, module: mod || null });
  }
  if (feed.sort?.fieldId) {
    const dir = feed.sort.dir === "desc" ? -1 : 1;
    const val = (o) => {
      if (feed.sort.fieldId === "label") return o.occurrence.label || o.module?.label || "";
      const v = o.occurrence.fields?.[feed.sort.fieldId];
      return v && typeof v === "object" && "value" in v ? v.value : v;
    };
    out.sort((a, b) => compareFieldValues(val(a), val(b)) * dir);
  }
  return out.slice(0, limit);
}
var _TIME_LABEL_RE = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i;
function _timeLabelToMinutes(v) {
  if (typeof v !== "string") return null;
  const m = v.match(_TIME_LABEL_RE);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ap = m[3]?.toLowerCase();
  if (!ap && !m[2]) return null;
  if (h > 23 || min > 59) return null;
  if (ap === "pm" && h !== 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return h * 60 + min;
}
function compareFieldValues(va, vb) {
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  const ta = _timeLabelToMinutes(va), tb = _timeLabelToMinutes(vb);
  if (ta != null && tb != null) return ta - tb;
  const na = typeof va === "number" ? va : va !== "" && !isNaN(Number(va)) ? Number(va) : null;
  const nb = typeof vb === "number" ? vb : vb !== "" && !isNaN(Number(vb)) ? Number(vb) : null;
  if (na != null && nb != null) return na - nb;
  const da = typeof va === "string" ? Date.parse(va) : NaN;
  const db = typeof vb === "string" ? Date.parse(vb) : NaN;
  if (!isNaN(da) && !isNaN(db)) return da - db;
  return String(va).localeCompare(String(vb));
}

// src/helpers/occurrenceLabel.js
function occurrenceDisplayLabel(occurrence, module, fallback = "") {
  const own = typeof occurrence?.label === "string" ? occurrence.label.trim() : "";
  if (own) return own;
  const type = typeof module?.label === "string" ? module.label.trim() : "";
  if (type) return type;
  return fallback;
}

// src/vr/shelfItems.js
var FILE_KINDS_FOR_ASSET = {
  book: ["pdf", "ebook"],
  record: ["audio"],
  vhs: ["video"]
};
function coverUrl(occ, mod, media) {
  if (media?.src && (media.kind === "image" || !media.kind)) return media.src;
  for (const c of [occ?.meta?.cover, mod?.meta?.cover]) {
    if (typeof c === "string" && c) return resolveFileRef(c);
    if (c && typeof c === "object" && typeof c.url === "string") return resolveFileRef(c.url);
  }
  return null;
}
function folderTree(rootId, foldersById) {
  const kids = /* @__PURE__ */ new Map();
  for (const f of Object.values(foldersById || {})) {
    if (!f?.parentId) continue;
    if (!kids.has(f.parentId)) kids.set(f.parentId, []);
    kids.get(f.parentId).push(f.id);
  }
  const out = /* @__PURE__ */ new Set([rootId]);
  const stack = [rootId];
  while (stack.length) for (const k of kids.get(stack.pop()) || []) if (!out.has(k)) {
    out.add(k);
    stack.push(k);
  }
  return out;
}
function folderShelfItems(rootId, { grid, occurrencesById, modulesById, foldersById, asset = "book" } = {}) {
  const fileKinds = FILE_KINDS_FOR_ASSET[asset] || [];
  if (!rootId || !occurrencesById) return [];
  const under = folderTree(rootId, foldersById);
  const gridId = grid?._id || grid?.id || null;
  const out = [];
  for (const occ of Object.values(occurrencesById)) {
    if (!occ?.parentId || !under.has(occ.parentId)) continue;
    if (gridId && occ.gridId && occ.gridId !== gridId) continue;
    const mod = modulesById?.[occ.moduleId];
    const isFile = mod?.role === "artifact" && fileKinds.includes(mod.kind);
    if (!isFile && (mod?.role !== "page" || mod.kind === "folder")) continue;
    const title = (occurrenceDisplayLabel(occ, mod) || mod?.meta?.originalName || "").trim();
    if (!title) continue;
    out.push({
      id: occ.id,
      rowId: occ.id,
      title,
      cover: coverUrl(occ, mod, null),
      sortOrder: occ.sortOrder ?? 0,
      fileId: isFile ? occ.id : null,
      fileKind: isFile ? mod.kind : null,
      src: isFile && mod.fileRef ? resolveFileRef(mod.fileRef) : null
    });
  }
  return out.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)).slice(0, 3e3);
}
function folderShelfView(rootId, at2, { grid, occurrencesById, modulesById, foldersById, asset = "book" } = {}) {
  if (!rootId) return { items: [], path: [], canUp: false, at: null };
  const under = folderTree(rootId, foldersById);
  const here = at2 && under.has(at2) ? at2 : rootId;
  const all = folderShelfItems(rootId, { grid, occurrencesById, modulesById, foldersById, asset });
  const childOf = (folderId) => {
    let f = folderId;
    for (let n = 0; f && n < 64; n++) {
      const parent = foldersById?.[f]?.parentId;
      if (parent === here) return f;
      f = parent;
    }
    return null;
  };
  const counts = /* @__PURE__ */ new Map();
  const direct = [];
  for (const it of all) {
    const parent = occurrencesById?.[it.rowId]?.parentId;
    if (parent === here) {
      direct.push(it);
      continue;
    }
    const c = childOf(parent);
    if (c) counts.set(c, (counts.get(c) || 0) + 1);
  }
  for (const f of Object.values(foldersById || {})) if (f?.parentId === here && under.has(f.id) && !counts.has(f.id)) counts.set(f.id, 0);
  const folders = [...counts.entries()].map(([fid, count]) => ({ id: "folder:" + fid, rowId: null, folder: true, count, title: foldersById?.[fid]?.name || "Folder", cover: null, fileId: null, fileKind: null, src: null })).sort((a, b) => a.title.localeCompare(b.title));
  const path = [];
  for (let f = here, n = 0; f && n < 64; n++) {
    path.unshift({ id: f, title: foldersById?.[f]?.name || "Folder" });
    if (f === rootId) break;
    f = foldersById?.[f]?.parentId;
  }
  return { items: [...folders, ...direct], path, canUp: here !== rootId, at: here };
}
function spotifyEmbedUrl(occ) {
  for (const cell of Object.values(occ?.fields || {})) {
    const v = cell && typeof cell === "object" && "value" in cell ? cell.value : cell;
    if (typeof v !== "string") continue;
    const m = /open\.spotify\.com\/(?:intl-[a-z]+\/)?(album|track|playlist|artist|episode|show)\/([A-Za-z0-9]+)/.exec(v);
    if (m) return `https://open.spotify.com/embed/${m[1]}/${m[2]}`;
  }
  if (/^[A-Za-z0-9]{22}$/.test(occ?.meta?.spotifyAlbumId || "")) return `https://open.spotify.com/embed/album/${occ.meta.spotifyAlbumId}`;
  if (occ?.meta?.searchProvider === "spotify" && /^[A-Za-z0-9]{10,}$/.test(occ.meta.searchExternalId || "")) {
    return `https://open.spotify.com/embed/track/${occ.meta.searchExternalId}`;
  }
  return null;
}
function artistNamed(occ, { occurrencesById, modulesById } = {}) {
  for (const cell of Object.values(occ?.fields || {})) {
    const v = cell && typeof cell === "object" && "value" in cell ? cell.value : cell;
    for (const id of Array.isArray(v) ? v : [v]) {
      const a = typeof id === "string" ? occurrencesById?.[id] : null;
      const m = a && modulesById?.[a.moduleId];
      if (m?.kind === "artist") return (occurrenceDisplayLabel(a, m) || "").trim() || null;
    }
  }
  return null;
}
function namesSongs(occ, modulesById, occurrencesById) {
  for (const cell of Object.values(occ?.fields || {})) {
    const v = cell && typeof cell === "object" && "value" in cell ? cell.value : cell;
    for (const id of Array.isArray(v) ? v : [v]) if (typeof id === "string" && modulesById?.[occurrencesById?.[id]?.moduleId]?.kind === "song") return true;
  }
  return false;
}
function albumSongIds(albumId, { occurrencesById, modulesById } = {}) {
  const album = occurrencesById?.[albumId];
  if (!album) return [];
  const isSong = (id) => modulesById?.[occurrencesById?.[id]?.moduleId]?.kind === "song";
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const cell of Object.values(album.fields || {})) {
    const v = cell && typeof cell === "object" && "value" in cell ? cell.value : cell;
    for (const id of Array.isArray(v) ? v : [v]) if (typeof id === "string" && !seen.has(id) && isSong(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  const naming = [];
  for (const o of Object.values(occurrencesById || {})) {
    if (seen.has(o.id) || !isSong(o.id)) continue;
    if (Object.values(o.fields || {}).some((c) => (c && typeof c === "object" ? c.value : c) === albumId)) {
      seen.add(o.id);
      naming.push(o);
    }
  }
  const num = (o) => Number.isFinite(o.meta?.trackNumber) ? o.meta.trackNumber : Infinity;
  naming.sort((a, b) => num(a) - num(b));
  for (const o of naming) out.push(o.id);
  return out;
}
function albumShelfItems(albumId, { occurrencesById, modulesById } = {}) {
  const album = occurrencesById?.[albumId];
  if (!album) return [];
  const albumMod = modulesById?.[album.moduleId];
  const ctx = { occurrencesById, modulesById };
  const albumCover = coverUrl(album, albumMod, primaryMediaOf(album, ctx));
  const albumSpotify = spotifyEmbedUrl(album);
  return albumSongIds(albumId, ctx).map((id) => {
    const occ = occurrencesById[id];
    const mod = modulesById?.[occ.moduleId];
    const f = filesOf(occ, ctx).find((e) => e.kind === "audio");
    const ref = f ? modulesById?.[f.occ.moduleId]?.fileRef : null;
    return {
      id: f?.occ?.id || occ.id,
      rowId: occ.id,
      title: (occurrenceDisplayLabel(occ, mod) || "").trim() || "Song",
      cover: coverUrl(occ, mod, primaryMediaOf(occ, ctx)) || albumCover,
      fileId: f?.occ?.id || null,
      fileKind: f ? "audio" : null,
      src: ref ? resolveFileRef(ref) : null,
      // A mini record is ONE song, in Spotify's mini player: its own track. Only a song with no Spotify track at all
      // (one filled in from a track list) falls back to the album's player, then to a Spotify search (user,
      // 2026-10-25: "i want mini players", not the web app).
      // ONLY its own track: the album's link played the album from track 1 ("playing the wrong song in the album").
      // A song with no Spotify track says so on the player instead.
      spotify: spotifyEmbedUrl(occ),
      mini: true
    };
  });
}
function showEpisodeItems(showId, { occurrencesById, modulesById } = {}) {
  const show = occurrencesById?.[showId];
  if (!show) return [];
  const ctx = { occurrencesById, modulesById };
  const showCover = coverUrl(show, modulesById?.[show.moduleId], primaryMediaOf(show, ctx));
  const eps = [];
  for (const o of Object.values(occurrencesById || {})) {
    if (!o?.meta?.episodeKey) continue;
    if (Object.values(o.fields || {}).some((c) => (c && typeof c === "object" ? c.value : c) === showId)) eps.push(o);
  }
  eps.sort((a, b) => String(a.label || "").localeCompare(String(b.label || ""), void 0, { numeric: true }));
  return eps.map((o) => {
    const mod = modulesById?.[o.moduleId];
    const f = filesOf(o, ctx).find((e) => e.kind === "video");
    const ref = f ? modulesById?.[f.occ.moduleId]?.fileRef : null;
    return {
      id: f?.occ?.id || o.id,
      rowId: o.id,
      title: (occurrenceDisplayLabel(o, mod) || "").trim() || "Episode",
      cover: coverUrl(o, mod, null) || showCover,
      fileId: f?.occ?.id || null,
      fileKind: f ? "video" : null,
      src: ref ? resolveFileRef(ref) : null
    };
  });
}
function bookmarkUrl(occ, mod) {
  if (mod?.kind !== "bookmark") return null;
  const u = occ?.meta?.url || mod.fileRef || "";
  return /^https?:\/\//i.test(u) ? u : null;
}
function shelfItems(shelf, { grid, occurrencesById, modulesById, foldersById } = {}) {
  if (shelf?.folderId) return folderShelfItems(shelf.folderId, { grid, occurrencesById, modulesById, foldersById, asset: shelf.asset });
  if (!shelf?.feed || !occurrencesById) return [];
  const hasQuery = Array.isArray(shelf.feed.conditions) && shelf.feed.conditions.length > 0 || !!shelf.feed.scope;
  if (!hasQuery) return [];
  const owner = { id: shelf.id, gridId: grid?._id || grid?.id || null, feed: { ...shelf.feed, enabled: true } };
  const rows = resolveFeedItems(owner, { occurrencesById, modulesById });
  const wanted = FILE_KINDS_FOR_ASSET[shelf.asset] || [];
  const ctx = { occurrencesById, modulesById };
  const out = [];
  for (const { occurrence: occ, module } of rows) {
    const mod = module || modulesById?.[occ.moduleId];
    const title = (occurrenceDisplayLabel(occ, mod) || mod?.meta?.originalName || "").trim();
    if (!title) continue;
    let file = null;
    if (mod?.role === "artifact" && wanted.includes(mod.kind)) file = { id: occ.id, kind: mod.kind, ref: mod.fileRef };
    else {
      const f = filesOf(occ, ctx).find((e) => wanted.includes(e.kind));
      if (f) file = { id: f.occ.id, kind: f.kind, ref: modulesById?.[f.occ.moduleId]?.fileRef };
    }
    out.push({
      id: file?.id || occ.id,
      rowId: occ.id,
      title,
      cover: coverUrl(occ, mod, primaryMediaOf(occ, ctx)),
      fileId: file?.id || null,
      fileKind: file?.kind || null,
      src: file?.ref ? resolveFileRef(file.ref) : null,
      url: bookmarkUrl(occ, mod),
      spotify: spotifyEmbedUrl(occ),
      // An album on a record shelf opens into its songs when dropped anywhere but a record player.
      // (An album row, or a row whose fields name songs. The albums filled in from track lists are named BY their
      // songs, so their own fields name none.)
      album: shelf.asset === "record" && (mod?.kind === "album" || namesSongs(occ, modulesById, occurrencesById)) || shelf.asset === "vhs" && mod?.kind === "series"
    });
  }
  return out;
}
function albumQueue(albumId, ctx = {}) {
  return albumShelfItems(albumId, ctx).filter((i) => typeof i.spotify === "string" && i.spotify.includes("/embed/track/")).map((i) => ({ title: i.title, url: i.spotify }));
}
function artistOfRow(occ, ctx) {
  return artistNamed(occ, ctx) || occ?.meta?.mediaArtist || occ?.meta?.spotifyArtist || null;
}
var musicCache = /* @__PURE__ */ new WeakMap();
function musicShelfView(shelf, at2, ctx = {}) {
  const { occurrencesById } = ctx;
  let byShelf = occurrencesById && musicCache.get(occurrencesById);
  if (!byShelf && occurrencesById) {
    byShelf = /* @__PURE__ */ new Map();
    musicCache.set(occurrencesById, byShelf);
  }
  let index = byShelf?.get(shelf.id);
  if (!index) {
    const items2 = shelfItems({ ...shelf, feed: { ...shelf.feed || {}, limit: 1e5 } }, ctx);
    const artists = /* @__PURE__ */ new Map();
    const pictures = /* @__PURE__ */ new Map();
    for (const o of Object.values(occurrencesById || {})) {
      const m = ctx.modulesById?.[o?.moduleId];
      if (m?.kind !== "artist") continue;
      const name = (occurrenceDisplayLabel(o, m) || "").trim();
      const pic = coverUrl(o, m, null);
      if (name && pic && !pictures.has(name)) pictures.set(name, pic);
    }
    for (const it of items2) {
      const occ = occurrencesById?.[it.rowId];
      const name = (artistOfRow(occ, ctx) || "Unknown artist").trim();
      if (!artists.has(name)) artists.set(name, { albums: [], songs: [], picture: pictures.get(name) || null });
      (it.album ? artists.get(name).albums : artists.get(name).songs).push(it);
    }
    const byTitle = (a, b) => a.title.localeCompare(b.title, void 0, { sensitivity: "base" });
    for (const v of artists.values()) {
      v.albums.sort(byTitle);
      v.songs.sort(byTitle);
    }
    index = { artists };
    byShelf?.set(shelf.id, index);
  }
  const key = typeof at2 === "string" && at2.startsWith("artist:") ? at2.slice(7) : null;
  const here = key && index.artists.get(key);
  if (here) return { items: [...here.albums, ...here.songs], path: [shelf.title, key], canUp: true };
  const items = [...index.artists.entries()].sort((a, b) => a[0].localeCompare(b[0], void 0, { sensitivity: "base" })).map(([name, v]) => ({ id: "artist:" + name, rowId: null, folder: true, count: v.albums.length + v.songs.length, title: name, cover: v.picture || v.albums[0]?.cover || null }));
  return { items, path: [], canUp: false };
}

// src/vr/officeConfig.js
function readOffice(grid) {
  const v = grid?.meta?.vrOffice || {};
  return {
    shelves: Array.isArray(v.shelves) ? v.shelves : [],
    screens: Array.isArray(v.screens) ? v.screens : []
  };
}

// src/vr/decorLibrary.js
var BUILTIN_DECOR = [
  { key: "armchair", title: "Armchair" },
  { key: "swivelchair", title: "Swivel chair" },
  { key: "ottoman", title: "Ottoman" },
  { key: "longtable", title: "Long table" },
  { key: "smalltable", title: "Small table" },
  { key: "desk", title: "Desk" },
  { key: "keyboard", title: "Keyboard" },
  { key: "tvframe", title: "TV frame" },
  { key: "recordplayer", title: "Record player" },
  { key: "vhsplayer", title: "VHS player" },
  { key: "clock", title: "Wall clock" },
  { key: "window", title: "Window" },
  { key: "openwindow", title: "Open window" },
  { key: "couch", title: "Couch" },
  { key: "bed", title: "Queen bed" },
  { key: "lamp", title: "Floor lamp" },
  { key: "desklamp", title: "Desk lamp" },
  { key: "plant", title: "Plant" },
  { key: "rug", title: "Rug" },
  { key: "candle", title: "Candle" },
  { key: "gridscreen", title: "Grid screen" },
  { key: "notepad", title: "New note" },
  { key: "browser", title: "Browser screen" },
  { key: "claude", title: "Claude screen" },
  { key: "remotedesktop", title: "PC screen (Remote Desktop)" }
];
function decorModels({ grid, occurrencesById, modulesById } = {}) {
  const gridId = grid?._id || grid?.id || null;
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const occ of Object.values(occurrencesById || {})) {
    const mod = modulesById?.[occ?.moduleId];
    if (mod?.role !== "artifact" || mod.kind !== "model" || !mod.fileRef || mod.trashed) continue;
    if (gridId && occ.gridId && occ.gridId !== gridId) continue;
    if (seen.has(mod.id)) continue;
    seen.add(mod.id);
    const title = (occ.label || mod.label || mod.meta?.originalName || "Model").replace(/\.(glb|gltf)$/i, "");
    out.push({ key: "model:" + occ.id, occId: occ.id, title, src: resolveFileRef(mod.fileRef) });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}
function decorLibrary(ctx) {
  return [...BUILTIN_DECOR, ...decorModels(ctx)];
}

// src/helpers/treeOrder.js
function sortOrderForDrop(siblings, targetId, edge, draggedId = null) {
  const sorted = (siblings || []).filter((s) => s && s.id !== draggedId).slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const idx = sorted.findIndex((s) => s.id === targetId);
  if (idx === -1) {
    const max = sorted.reduce((m, s) => Math.max(m, s.sortOrder ?? 0), -1);
    return max + 1;
  }
  const mine = sorted[idx].sortOrder ?? 0;
  if (edge === "top") {
    const prev = sorted[idx - 1];
    return prev ? ((prev.sortOrder ?? 0) + mine) / 2 : mine - 1;
  }
  const next = sorted[idx + 1];
  return next ? (mine + (next.sortOrder ?? 0)) / 2 : mine + 1;
}
function sortOrderAtEnd(siblings) {
  return (siblings || []).reduce((m, s) => Math.max(m, s?.sortOrder ?? 0), -1) + 1;
}

// src/vr/officeState.js
var BOOKMARK_BAR_MAX = 40;
function findBookmarksBoard({ occurrencesById, modulesById }) {
  let best = null;
  let bestCount = -1;
  for (const occ of Object.values(occurrencesById || {})) {
    const mod = modulesById?.[occ?.moduleId];
    if (mod?.role !== "container" || (occ.label || mod.label) !== "Bookmarks") continue;
    const count = (occ.occurrences || []).filter((id) => modulesById?.[occurrencesById[id]?.moduleId]?.kind === "bookmark").length;
    if (count > bestCount) {
      best = occ;
      bestCount = count;
    }
  }
  return best;
}
function bookmarkBar({ occurrencesById, modulesById }) {
  const board = findBookmarksBoard({ occurrencesById, modulesById });
  const out = [];
  for (const id of board?.occurrences || []) {
    const occ = occurrencesById[id];
    const mod = modulesById?.[occ?.moduleId];
    if (mod?.kind !== "bookmark" || !occ.meta?.browserBar) continue;
    const url = occ.meta?.url || mod.fileRef;
    if (!url) continue;
    out.push({ title: (occ.label || mod.label || url).slice(0, 60), url });
    if (out.length >= BOOKMARK_BAR_MAX) break;
  }
  return out;
}
function nativeOfficeState({ grid, occurrencesById, modulesById, foldersById, shelfAt = {}, origin = "" }, pageLabel = null, only = null) {
  pageLabel = pageLabel || ((id) => {
    const o = occurrencesById?.[id];
    return o ? o.label || modulesById?.[o.moduleId]?.label || "Page" : null;
  });
  const office = readOffice(grid);
  const ctx = { grid, occurrencesById, modulesById, foldersById };
  const wire = (i) => ({
    id: i.id,
    rowId: i.rowId || null,
    title: i.title,
    cover: i.cover,
    src: i.src || null,
    kind: i.fileKind || null,
    url: i.url || null,
    folder: !!i.folder,
    count: i.count || 0,
    spotify: i.spotify || null,
    album: !!i.album,
    mini: !!i.mini
  });
  const wanted = Array.isArray(only) && only.length ? new Set(only) : null;
  const shelves = (wanted ? office.shelves.filter((s) => wanted.has(s.id)) : office.shelves).map((s) => {
    const at2 = shelfAt[s.id];
    if (typeof at2 === "string" && at2.startsWith("album:")) {
      const albumId = at2.slice(6).split("|")[0];
      const album = occurrencesById?.[albumId];
      const title = album ? occurrenceDisplayLabel(album, modulesById?.[album.moduleId]) || "Album" : "Album";
      if (s.asset === "vhs") return { id: s.id, title: s.title, asset: s.asset, items: showEpisodeItems(albumId, ctx).map(wire), path: [s.title, title], canUp: true };
      const songs = albumShelfItems(albumId, ctx).sort((a, b) => a.title.localeCompare(b.title, void 0, { sensitivity: "base" }));
      const prev = at2.split("|")[1] || "";
      const artist = prev.startsWith("artist:") ? [prev.slice(7)] : [];
      return { id: s.id, title: s.title, asset: s.asset, items: songs.map(wire), path: [s.title, ...artist, title], canUp: true };
    }
    if (s.folderId) {
      const v = folderShelfView(s.folderId, shelfAt[s.id], { ...ctx, asset: s.asset });
      return { id: s.id, title: s.title, asset: s.asset, items: v.items.map(wire), path: v.path.map((p) => p.title), canUp: v.canUp, folderable: true };
    }
    if (s.asset === "record") {
      const v = musicShelfView(s, at2, ctx);
      return { id: s.id, title: s.title, asset: s.asset, items: v.items.map(wire), path: v.path, canUp: v.canUp };
    }
    return { id: s.id, title: s.title, asset: s.asset, items: shelfItems(s, ctx).map(wire), path: [], canUp: false };
  });
  if (wanted) return { type: "state", partial: true, gridId: String(grid?._id || grid?.id || ""), origin, shelves };
  return {
    type: "state",
    gridId: String(grid?._id || grid?.id || ""),
    origin,
    shelves,
    screens: office.screens.map((s) => ({
      id: s.id,
      source: s.source,
      pageOccId: s.pageOccId || null,
      label: s.source === "grid" ? "The grid" : s.pageOccId ? pageLabel(s.pageOccId) || "Missing page" : "No page chosen"
    })),
    decor: decorLibrary({ grid, occurrencesById, modulesById }).map((d) => ({ key: d.key, title: d.title, src: d.src || null })),
    layout: grid?.meta?.vrLayout || null,
    bookmarks: bookmarkBar({ occurrencesById, modulesById })
  };
}
function findDayPage({ occurrencesById, modulesById, foldersById } = {}) {
  const inTemplates = (folderId) => {
    let f = foldersById?.[folderId];
    let n = 0;
    while (f && n++ < 30) {
      if (f.name === "Templates") return true;
      f = foldersById?.[f.parentId];
    }
    return false;
  };
  for (const occ of Object.values(occurrencesById || {})) {
    const mod = modulesById?.[occ?.moduleId];
    if (mod?.role !== "page" || (occ.label || mod.label) !== "Day Page") continue;
    if (occ.parentId && inTemplates(occ.parentId)) continue;
    return occ.id;
  }
  return null;
}
function findNotesFolder(foldersById) {
  const all = Object.values(foldersById || {});
  const notes = all.filter((f) => f?.name === "Notes");
  return (notes.find((f) => foldersById[f.parentId]?.name === "Documents") || notes[0] || null)?.id || null;
}
function planShelfReorder({ shelf, at: at2, id, targetId, edge }, { occurrencesById, modulesById, foldersById }) {
  if (!shelf?.folderId || !occurrencesById?.[id]) return [];
  const ctx = { occurrencesById, modulesById, foldersById, asset: shelf.asset };
  const here = folderShelfView(shelf.folderId, at2, ctx).at || shelf.folderId;
  const pagesIn = (folderId) => Object.values(occurrencesById).filter((o) => o?.parentId === folderId && o.id !== id && ["page", "artifact"].includes(modulesById?.[o.moduleId]?.role) && modulesById?.[o.moduleId]?.kind !== "folder");
  if (edge === "end") return [{ id, folder: here, sortOrder: sortOrderAtEnd(pagesIn(here)) }];
  if (edge === "up") {
    const up = here !== shelf.folderId ? foldersById?.[here]?.parentId : null;
    return up ? [{ id, folder: up, sortOrder: sortOrderAtEnd(pagesIn(up)) }] : [];
  }
  if (String(targetId || "").startsWith("folder:")) {
    const dest = String(targetId).slice(7);
    return [{ id, folder: dest, sortOrder: sortOrderAtEnd(pagesIn(dest)) }];
  }
  const moves = [];
  const title = (o) => o.label || modulesById?.[o.moduleId]?.label || "";
  let sibs = pagesIn(here).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || title(a).localeCompare(title(b)));
  if (new Set(sibs.map((o) => o.sortOrder ?? 0)).size < sibs.length) {
    sibs = sibs.map((o, i) => {
      moves.push({ id: o.id, folder: here, sortOrder: i });
      return { ...o, sortOrder: i };
    });
  }
  moves.push({ id, folder: here, sortOrder: sortOrderForDrop(sibs, targetId, edge === "before" ? "top" : "bottom", id) });
  return moves;
}

// src/helpers/protectedFolders.js
function isProtectedFolder(folder) {
  return !!folder?.meta?.protected;
}

// src/helpers/folderDeletePlan.js
var isFolderPage = (occ, modulesById) => {
  const m = modulesById?.[occ?.moduleId];
  return m?.role === "page" && m?.kind === "folder";
};
function planFolderDelete(folder, { occurrencesById, foldersById, modulesById }) {
  if (!folder?.id || isProtectedFolder(folder)) return null;
  const occs = Object.values(occurrencesById || {}).filter((o) => o?.parentId === folder.id);
  return {
    deleteOccIds: occs.filter((o) => isFolderPage(o, modulesById)).map((o) => o.id),
    moveOccIds: occs.filter((o) => !isFolderPage(o, modulesById)).map((o) => o.id),
    moveFolderIds: Object.values(foldersById || {}).filter((f) => f?.parentId === folder.id).map((f) => f.id),
    parentId: folder.parentId || null
  };
}
export {
  BOOKMARK_BAR_MAX,
  albumQueue,
  albumShelfItems,
  bookmarkBar,
  decorLibrary,
  findBookmarksBoard,
  findDayPage,
  findNotesFolder,
  folderShelfView,
  musicShelfView,
  nativeOfficeState,
  occurrenceDisplayLabel,
  planFolderDelete,
  planShelfReorder,
  readOffice,
  shelfItems,
  showEpisodeItems
};
