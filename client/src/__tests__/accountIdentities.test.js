// An account is an IDENTITY, not a tile.
//
// User, 2026-09-06: *"what im saying is that i dont want these empty tiles for
// each account now. why would you keep those in, i dont want these empty rows."*
//
// I had kept the four account rows on the Financial group because eleven stored
// transactions point at them. That is a reason to keep them ADDRESSABLE, and I
// treated it as a reason to keep them ON SCREEN. `occurrence.hidden` is exactly
// the line between the two, and it is drawn in ONE place — `isOccurrenceVisible`
// — so hiding a row removes it from the render and from nothing else.
//
// THE TWO HALVES HAVE TO BE ASSERTED TOGETHER, which is the whole point of this
// file: "gone from the page" is trivially satisfiable by breaking the account
// (delete it, unlist it, unhook the gate) and every one of those would silently
// break a purchase's Account pick. So each disappearance is paired with the
// thing that must SURVIVE it.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isOccurrenceVisible } from "../state/selectors";
import { resolveOptions } from "../helpers/optionsResolver";
import { buildStampFields, collectPredicateFieldIds } from "../helpers/addNewOption";

vi.setConfig({ testTimeout: 60000 });

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "fixtures", "pomsGrid.json.br");

let base;
beforeAll(() => { base = JSON.parse(brotliDecompressSync(readFileSync(FIXTURE)).toString()); });

function world() {
  const fx = JSON.parse(JSON.stringify(base));
  const by = (a) => Object.fromEntries(a.map((x) => [x.id, x]));
  const occurrencesById = by(fx.occurrences);
  const modulesById = by(fx.modules);
  const fieldsById = by(fx.fields);
  return { fx, occurrencesById, modulesById, fieldsById };
}

const labelOf = (w, o) => o && (o.label || w.modulesById[o.moduleId]?.label);
const accountField = (w) =>
  w.fx.fields.find((f) => f.name === "Account" && f.type === "occurrence");

/** The four rows a transaction can name — found by the GATE, never the label. */
function accountRows(w) {
  const left = `$item.fields.${accountField(w).id}.value`;
  const ids = new Set();
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    if (n.left === left && n.comparator === "IS" && w.occurrencesById[n.right]) ids.add(n.right);
    Object.values(n).forEach(walk);
  };
  w.fx.operations.forEach((op) => walk(op.pipeline));
  return [...ids].map((id) => w.occurrencesById[id]);
}

describe("the four accounts are identities, not tiles", () => {
  it("finds all four accounts through the Account gate", () => {
    const w = world();
    const names = accountRows(w).map((o) => labelOf(w, o)).sort();
    // The CONTROL for every test below: if the gate stops naming four rows,
    // the other assertions are about an empty set and prove nothing.
    expect(names).toEqual(["Cash", "Checking Account", "Mom's Account", "Savings Account"]);
  });

  it("does not render them on the group that lists them", () => {
    const w = world();
    // BY WHAT IT LISTS, not by its name. Two containers on this grid are
    // labelled "Financial" — the money group and the Routines dimension — so a
    // label lookup picks whichever comes first and tests the wrong one.
    const acctIds = new Set(accountRows(w).map((o) => o.id));
    const fin = w.fx.occurrences.find((o) => (o.occurrences || []).some((id) => acctIds.has(id)));
    expect(fin, "nothing lists the account rows").toBeTruthy();
    const children = (fin.occurrences || []).map((id) => w.occurrencesById[id]).filter(Boolean);
    const shown = children.filter((o) => isOccurrenceVisible(o, {}, null)).map((o) => labelOf(w, o));

    for (const n of ["Checking Account", "Savings Account", "Mom's Account", "Cash"]) {
      expect(shown, `"${n}" is still rendering as an empty row`).not.toContain(n);
    }
    // And the group still shows the tiles that carry numbers — without this,
    // "the accounts are gone" is also satisfied by a group that renders nothing.
    expect(shown).toContain("Accounts");
    expect(shown).toContain("Net Worth");
  });

  const pickerFor = (w, name) =>
    w.fx.fields.find((f) => f.name === name && f.type === "occurrence");

  const offeredBy = (w, field) =>
    resolveOptions(field, {
      occurrencesById: w.occurrencesById,
      modulesById: w.modulesById,
      fieldsById: w.fieldsById,
    }).options;

  // BOTH pickers, driven through the REAL resolver. `Account` says where money
  // came from and `To Account` where a transfer landed — narrowing one and
  // leaving the other still offers forty tiles as a transfer destination.
  for (const name of ["Account", "To Account"]) {
    it(`offers exactly the four accounts in "${name}"`, () => {
      const w = world();
      const field = pickerFor(w, name);
      expect(field, `no occurrence field named "${name}"`).toBeTruthy();

      const options = offeredBy(w, field);
      const offered = new Set(options.map((o) => o.value));
      const accounts = accountRows(w);

      // Half one: every account is pickable. `hidden` is read only by the
      // render path, so leaving the page must not cost a row its place here.
      for (const acct of accounts) {
        expect(offered.has(acct.id), `"${labelOf(w, acct)}" fell out of "${name}"`).toBe(true);
      }
      // Half two — the ask. Ancestry offered all 40 tracker tiles, so a purchase
      // could be charged to Water or to Net Worth (the sum of your accounts).
      const strays = options
        .filter((o) => !accounts.some((a) => a.id === o.value))
        .map((o) => o.label);
      expect(strays, `"${name}" still offers non-accounts`).toEqual([]);
      expect(options).toHaveLength(accounts.length);

      // By NAME, not by raw id — the 0310 regression.
      const labels = new Set(options.map((o) => o.label));
      for (const n of ["Checking Account", "Savings Account", "Mom's Account", "Cash"]) {
        expect(labels, `"${n}" lost its name in "${name}"`).toContain(n);
      }
    });
  }

  it("lets a newly added account be picked in the dropdown it was added from", () => {
    const w = world();
    const field = pickerFor(w, "Account");
    const addNew = field.meta?.optionsSource?.addNew || {};
    const parentId = addNew.parentOccurrenceId || (addNew.targets || [])[0];
    const parent = w.occurrencesById[parentId];
    expect(parent, "the Account dropdown has no add-new destination").toBeTruthy();

    // `buildStampFields` copies the CHOSEN PARENT's values for exactly the
    // fields the predicate matches on. If the parent carries none of them, a
    // new account is created and is then invisible in the dropdown it was
    // added from — created, silent, unpickable.
    const needed = collectPredicateFieldIds(field.meta.optionsSource);
    expect(needed.length, "the predicate matches on no field — nothing to inherit").toBeGreaterThan(0);

    const stamp = buildStampFields(field, parent);
    for (const fid of needed) {
      expect(stamp[fid], `add-new parent "${labelOf(w, parent)}" carries no ${w.fieldsById[fid]?.name}`)
        .toBeTruthy();
    }
  });

  it("keeps every stored Account pick resolving", () => {
    const w = world();
    const fid = accountField(w).id;
    let picks = 0, dangling = 0;
    for (const o of w.fx.occurrences) {
      const v = o.fields?.[fid]?.value;
      if (!v) continue;
      for (const id of (Array.isArray(v) ? v : [v])) {
        picks++;
        if (!w.occurrencesById[id]) dangling++;
      }
    }
    expect(picks, "no transaction names an account — the check is vacuous").toBeGreaterThan(0);
    expect(dangling).toBe(0);
  });

  it("carries no number an account row would have to display", () => {
    const w = world();
    for (const acct of accountRows(w)) {
      const mod = w.modulesById[acct.moduleId];
      const bound = new Set((mod?.fieldBindings || []).map((b) => b.fieldId));
      // A value on a field the row does not bind renders NOWHERE (the `0047`
      // class inverted). `Spent` and `Earned` each wrote one here for a day.
      const orphans = Object.keys(acct.fields || {}).filter((f) => !bound.has(f));
      expect(orphans.map((f) => w.fieldsById[f]?.name || f),
        `"${labelOf(w, acct)}" holds a value nothing can render`).toEqual([]);
    }
  });

  it("has no operation writing into an account row", () => {
    const w = world();
    const acctIds = new Set(accountRows(w).map((o) => o.id));
    const offenders = [];

    for (const op of w.fx.operations.filter((o) => o.enabled !== false)) {
      const bound = {};
      const collect = (n) => {
        if (Array.isArray(n)) return n.forEach(collect);
        if (!n || typeof n !== "object") return;
        const c = n.config;
        if (c?.type === "INIT_VAR" && typeof c.expr === "string" && c.name) {
          const m = /^\$allItemsById\.([A-Za-z0-9_-]+)$/.exec(c.expr);
          if (m) bound[c.name] = m[1];
        }
        Object.values(n).forEach(collect);
      };
      const check = (n) => {
        if (Array.isArray(n)) return n.forEach(check);
        if (!n || typeof n !== "object") return;
        const c = n.config;
        if (c?.type === "UPDATE" && typeof c.path === "string") {
          for (const [v, oid] of Object.entries(bound)) {
            if (c.path.startsWith(`${v}.`) && acctIds.has(oid)) offenders.push(`${op.name} -> ${c.path}`);
          }
        }
        Object.values(n).forEach(check);
      };
      collect(op.pipeline);
      check(op.pipeline);
    }
    // A write into a hidden row is a number nobody can ever see. Both of these
    // existed (`Spent` into Checking, `Earned` into Savings) until 0313.
    expect(offenders).toEqual([]);
  });

  it("still gates each balance on its own account", () => {
    const w = world();
    const left = `$item.fields.${accountField(w).id}.value`;
    for (const name of ["Checking Balance", "Savings Balance", "Cash Balance", "Mom's Account Balance"]) {
      const op = w.fx.operations.find((o) => o.name === name);
      expect(op, `no "${name}" operation`).toBeTruthy();
      const gated = new Set();
      const walk = (n) => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (!n || typeof n !== "object") return;
        if (n.left === left && n.right) gated.add(labelOf(w, w.occurrencesById[n.right]) || n.right);
        Object.values(n).forEach(walk);
      };
      walk(op.pipeline);
      // Exactly ONE account, or the balance is summing somebody else's money.
      expect([...gated], `"${name}" gates on the wrong number of accounts`).toHaveLength(1);
    }
  });
});
