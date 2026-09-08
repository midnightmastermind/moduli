// A trigger scoped by a NAME is a trigger a rename can switch off.
//
// User, 2026-09-08: *"would it be easier not to look at labels since those
// change but to mark occurances with a certain field like we do with a lot of
// them"* — and the grid had already proved the point. The Goals page became
// "Trackers" in July; `Completed Habits` and `Sleep Time` kept
// `ancestorLabel: "Goals"` on their filter-change trigger, and the only things
// still carrying that label are **Project Scope sections inside project pages**.
// So those two tiles stopped recomputing when the date changed — while still
// recomputing on load and on a `Completed` write, which is why nobody saw it.
// A PARTIAL silent failure is the worst kind.
//
// `matchAncestorScope` checks `ancestorId` against `_ancestorIds` before it ever
// looks at labels, so the rename-proof form already exists. This does not force
// it — 48 ops are still scoped by a live label and converting them is its own
// pass. What it forbids is the state that bit us: a trigger naming an ancestor
// that resolves to NOTHING, or to SEVERAL different things.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

vi.setConfig({ testTimeout: 60000 });
const here = path.dirname(fileURLToPath(import.meta.url));
let fx;
beforeAll(() => {
  fx = JSON.parse(brotliDecompressSync(
    readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString());
});

const world = () => {
  const modulesById = Object.fromEntries(fx.modules.map((m) => [m.id, m]));
  const occurrencesById = Object.fromEntries(fx.occurrences.map((o) => [o.id, o]));
  const labelOf = (o) => o && (o.label || modulesById[o.moduleId]?.label);
  const enabled = fx.operations.filter((o) => o.enabled !== false);
  return { modulesById, occurrencesById, labelOf, enabled };
};

/** Every (op, trigger) pair that scopes by an ancestor LABEL. */
const labelScoped = (w) => w.enabled.flatMap((op) =>
  (op.triggerObjects || [])
    .filter((t) => t?.ancestorLabel)
    .map((t) => ({ op: op.name, label: t.ancestorLabel, event: t.eventType })));

describe("triggers scoped by an ancestor", () => {
  it("scope by ID, never by a name", () => {
    const w = world();
    const byId = w.enabled.flatMap((op) =>
      (op.triggerObjects || []).filter((t) => t?.ancestorId).map((t) => ({ op: op.name, id: t.ancestorId })));
    // CONTROL: there ARE ancestor-scoped triggers, so "none use a label" is a
    // measurement rather than a statement about an empty set. 0319 converted 48.
    expect(byId.length, "no trigger is ancestor-scoped — this test proves nothing").toBeGreaterThan(10);

    const byLabel = labelScoped(w).map((s) => `${s.op} (${s.event}) -> "${s.label}"`);
    // A name can be renamed out from under an op, and it already was: the Goals
    // page became Trackers in July and two trackers quietly stopped recomputing
    // on a date change. An id survives a rename.
    expect(byLabel, "a trigger is scoped by a page NAME").toEqual([]);
  });

  it("scope to something that exists and can BE an ancestor", () => {
    const w = world();
    const bad = [];
    for (const op of w.enabled) {
      for (const t of op.triggerObjects || []) {
        if (!t?.ancestorId) continue;
        const o = w.occurrencesById[t.ancestorId];
        // A stale id is exactly as dead as a stale name — this is the failure
        // mode the conversion could introduce, so it is pinned.
        if (!o) { bad.push(`${op.name} -> missing ${t.ancestorId}`); continue; }
        const role = w.modulesById[o.moduleId]?.role;
        if (!["page", "container", "panel"].includes(role))
          bad.push(`${op.name} -> ${role} "${w.labelOf(o)}" cannot be an ancestor`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the two a rename switched off still react to a date change", () => {
    const w = world();
    for (const name of ["Completed Habits", "Sleep Time"]) {
      const op = w.enabled.find((o) => o.name === name);
      expect(op, `no "${name}" operation`).toBeTruthy();
      const nav = (op.triggerObjects || []).filter((t) => t?.eventType === "onFilterChange");
      expect(nav.length, `"${name}" no longer reacts to a date change at all`).toBeGreaterThan(0);
      for (const t of nav) {
        expect(t.ancestorId, `"${name}" is still scoped by a name`).toBeTruthy();
        const o = w.occurrencesById[t.ancestorId];
        expect(o, `"${name}" is scoped to an id that does not exist`).toBeTruthy();
        // And to the page its own tile lives on — not merely to SOMETHING.
        expect(w.labelOf(o)).toBe("Trackers");
      }
    }
  });
});

describe("pipeline rules identify a row by a marker, not by its name", () => {
  // A label is renameable AND is two fields (`occurrence.label` falling back to
  // the module's), so a rule keyed on one is two different fragilities at once.
  // 0320 moved three ops onto markers the grid ALREADY stamps — the Time Slot
  // identity value, `identitySignature`, and the module id — without minting
  // anything new.
  const literalLabelRules = (w) => {
    const out = [];
    const walk = (n, op) => {
      if (Array.isArray(n)) return n.forEach((x) => walk(x, op));
      if (!n || typeof n !== "object") return;
      if (n.comparator === "IS" && typeof n.right === "string" && !n.right.startsWith("$")
          && /(^|\.)(label|moduleLabel|containerLabel)$/.test(String(n.left || "")))
        out.push({ op, left: n.left, right: n.right });
      Object.values(n).forEach((v) => walk(v, op));
    };
    for (const op of w.enabled) walk(op.pipeline, op.name);
    return out;
  };

  it("no pipeline rule identifies a row by its name", () => {
    const w = world();
    const found = literalLabelRules(w).map((r) => `${r.op}: ${r.left} IS "${r.right}"`);

    // The last two were the ALARM dedupes — an alarm asking "did I already
    // create today's row?" by name, so renaming it in the Alarms tab made it
    // stop recognising its own row and mint a second one every day. Every
    // marker already on those rows matched a WIDER set (the 5pm Time Slot
    // matches 25 rows, not 5), which is why 0320 correctly refused to convert
    // them and 0321 gave them a marker of their own instead.
    expect(found, "a rule still identifies a row by its name").toEqual([]);
  });

  it("the three that moved match exactly what they used to", () => {
    const w = world();
    const rules = [];
    const walk = (n, op) => {
      if (Array.isArray(n)) return n.forEach((x) => walk(x, op));
      if (!n || typeof n !== "object") return;
      // A `$var` right is resolved at run time — only LITERAL markers can be
      // checked against the data here.
      if (n.comparator === "IS" && typeof n.right === "string" && !n.right.startsWith("$")
          && /(^|\.)(identitySignature|templateId)$/.test(String(n.left || "")))
        rules.push({ op, left: n.left, right: n.right });
      Object.values(n).forEach((v) => walk(v, op));
    };
    for (const op of w.enabled) walk(op.pipeline, op.name);

    // A marker nothing carries is as dead as a renamed label — EXCEPT where the
    // op MINTS it. An alarm's dedupe looks for a row it is about to create, so
    // "matches nothing" there is the alarm simply not having fired yet; what
    // makes it sound is that the op's own CREATE stamps the same signature.
    const mintedBy = (opName, sig) => {
      const op = w.enabled.find((o) => o.name === opName);
      let mints = false;
      const walk2 = (n) => {
        if (Array.isArray(n)) return n.forEach(walk2);
        if (!n || typeof n !== "object") return;
        if (n.config?.type === "CREATE" && n.config.identitySignature === sig) mints = true;
        Object.values(n).forEach(walk2);
      };
      walk2(op?.pipeline);
      return mints;
    };
    for (const r of rules) {
      const hits = fx.occurrences.filter((o) =>
        r.left.endsWith("identitySignature") ? o.identitySignature === r.right : o.moduleId === r.right);
      if (hits.length) continue;
      expect(mintedBy(r.op, r.right),
        `${r.op}: ${r.left} IS "${r.right}" matches nothing and the op does not mint it`).toBe(true);
    }
    // CONTROL: the conversion actually happened.
    expect(rules.length, "no rule matches on a marker — 0320 did not apply").toBeGreaterThan(2);
  });
});
