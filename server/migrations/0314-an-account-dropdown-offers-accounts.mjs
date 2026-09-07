// The Account dropdown offered every tracker tile on the grid.
//
// User, 2026-09-06: *"keep going and narrow the account dropdown please."*
//
// Both account pickers — `Account` and `To Account` — resolved by
//
//     $record._ancestors HAS_ANCESTOR <Trackers page>
//
// with no further narrowing, so choosing the account for a purchase offered all
// FORTY tracker tiles: Water, Steps, Pomodoros, Mood, Sleep, Coffee. Ancestry is
// a fact about where a row is filed; it says nothing about what a row IS.
//
// ── THE TAG IS THE MECHANISM THIS GRID ALREADY HAS ────────────────────────
//
// `Board Category` is the scoping tag: 30-odd dropdowns resolve
// `fields.<Board Category>.value CONTAINS <tag> AND meta.feedSourceId IS_EMPTY`,
// and 44 CONTAINERS carry their own tag so a row added through "+ Add new"
// inherits exactly the tag of wherever it was made. An account is precisely the
// kind of thing that vocabulary names — something you PICK — so this adds one
// value to it rather than inventing a second mechanism beside it.
//
// TWO NEAR-MISSES WERE MEASURED AND REJECTED, and both would have been wrong by
// exactly one row:
//
//     meta.cumulative        5 rows — the four accounts AND Net Worth
//     Tracker Scope "Total"  5 rows — the same five
//
// Net Worth is a running total, not an account, and a picker that offered it
// would let a purchase be charged to the sum of your accounts. It is also the
// `meta.<flag>` shape this repo has ruled out for identity: a marker the system
// can introspect as DATA is the rule, and `Board Category` is that.
//
// ── THE ADD-NEW PATH IS WHY THE CONTAINER GETS THE TAG TOO ────────────────
//
// `collectPredicateFieldIds` reads the `fields.<fid>.value` lefts out of the
// dropdown's own predicate and `buildStampFields` copies the CHOSEN PARENT's
// values for them onto the new option. So without the tag on the addNew parent,
// a newly added account would be created and then be invisible in the very
// dropdown it was added from — a silent failure. The migration refuses unless
// the parent ends up carrying it.
//
// Idempotent: converges once both predicates name the tag and the five rows
// carry it.
import Field from "../models/Field.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0314-an-account-dropdown-offers-accounts";
export const description =
  "Both account pickers resolve by the Board Category tag, not by ancestry.";
export const touches = ["fields", "modules", "occurrences", "operations"];

const TAG = "account";
const PICKERS = ["Account", "To Account"];

const walk = (n, fn) => {
  if (Array.isArray(n)) return n.forEach((x) => walk(x, fn));
  if (n && typeof n === "object") { fn(n); Object.values(n).forEach((v) => walk(v, fn)); }
};

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const mods   = await Module.find({ gridId: gid }).lean();
  const occs   = await Occurrence.find({ gridId: gid }).lean();
  const ops    = await Operation.find({ gridId: gid }).lean();

  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const occById = Object.fromEntries(occs.map((o) => [o.id, o]));
  const labelOf = (o) => o && (o.label || modById[o.moduleId]?.label || "(unlabeled)");

  const one = (name, pred, what) => {
    const hits = fields.filter(pred);
    if (hits.length !== 1) throw new Error(`expected exactly 1 ${what}, found ${hits.length} - refusing`);
    return hits[0];
  };
  const bc = one("Board Category", (f) => f.name === "Board Category" && f.type === "select", `field named "Board Category"`);
  const acctField = one("Account", (f) => f.name === "Account" && f.type === "occurrence", `occurrence field named "Account"`);

  // ── THE FOUR, BY THE GATE — the same durable selector 0313 uses ──────────
  const gateLeft = `$item.fields.${acctField.id}.value`;
  const accountIds = new Set();
  for (const op of ops) walk(op.pipeline, (n) => {
    if (n.left === gateLeft && n.comparator === "IS" && occById[n.right]) accountIds.add(n.right);
  });
  if (!accountIds.size) throw new Error(`no operation gates on "Account" - refusing to guess which rows are accounts`);
  log(`  accounts: ${[...accountIds].map((i) => labelOf(occById[i])).join(" · ")}`);

  // ── THE VALUE SHAPE IS COPIED FROM A LIVE EXEMPLAR, NOT PICKED ──────────
  // 12,703 rows store this as an ARRAY. Writing a bare string would resolve
  // through CONTAINS today and be the odd one out the moment anything reads it
  // as a list.
  const exemplar = occs.find((o) => Array.isArray(o.fields?.[bc.id]?.value) && o.fields[bc.id].value.length);
  if (!exemplar) throw new Error(`no occurrence carries a Board Category array to copy the shape from - refusing`);
  const shape = (tag) => [tag];
  log(`  tag shape from "${labelOf(exemplar)}": ${JSON.stringify(exemplar.fields[bc.id].value)} -> ${JSON.stringify(shape(TAG))}`);

  // ── 1. THE OPTION LIST LEARNS THE WORD ──────────────────────────────────
  const values = Array.isArray(bc.meta?.optionsSource?.values) ? [...bc.meta.optionsSource.values] : null;
  if (!values) throw new Error(`"Board Category" has no manual option list - refusing`);
  if (!values.includes(TAG)) {
    values.push(TAG);
    log(`  Board Category: adding "${TAG}" (${values.length} options)`);
    if (apply) await Field.updateOne({ id: bc.id, gridId: gid },
      { $set: { "meta.optionsSource.values": values } });
  } else log(`  Board Category: already offers "${TAG}"`);

  // ── 2. THE FOUR CARRY THE TAG, AND THEIR MODULES BIND IT HIDDEN ─────────
  // A predicate reads the OCCURRENCE's fields, so the binding is not what makes
  // the match work — it is what stops the value being an untracked orphan
  // (`0047`), and hidden because an identity tag is not something to render.
  const addNewParents = new Set();
  let tagged = 0, bound = 0;
  const needTag = [...accountIds];

  for (const name of PICKERS) {
    const f = fields.find((x) => x.name === name && x.type === "occurrence");
    if (!f) throw new Error(`no occurrence field named "${name}" - refusing`);
    const p = f.meta?.optionsSource?.addNew?.parentOccurrenceId;
    if (p) addNewParents.add(p);
  }
  for (const p of addNewParents) {
    if (!occById[p]) throw new Error(`addNew parent ${p} does not exist - refusing`);
    needTag.push(p);
  }

  for (const oid of needTag) {
    const occ = occById[oid];
    const cur = occ.fields?.[bc.id]?.value;
    const has = Array.isArray(cur) ? cur.includes(TAG) : cur === TAG;
    const isAccount = accountIds.has(oid);
    if (!has) {
      const next = Array.isArray(cur) ? [...new Set([...cur, TAG])] : shape(TAG);
      log(`  ${labelOf(occ)}${isAccount ? "" : " (addNew parent)"}: Board Category ${JSON.stringify(cur ?? null)} -> ${JSON.stringify(next)}`);
      if (apply) await Occurrence.updateOne({ id: oid, gridId: gid },
        { $set: { [`fields.${bc.id}`]: { value: next, flow: "in" } } });
      tagged++;
    }
    // Bind it hidden on the ACCOUNT modules only; the parent is a container
    // whose tag is config, not something it displays.
    if (!isAccount) continue;
    const mod = modById[occ.moduleId];
    if (!mod) throw new Error(`"${labelOf(occ)}" has no module - refusing`);
    const bindings = mod.fieldBindings || [];
    if (!bindings.some((b) => b.fieldId === bc.id)) {
      const next = [...bindings, { fieldId: bc.id, role: "input", order: bindings.length, hidden: true }];
      if (apply) await Module.updateOne({ id: mod.id, gridId: gid }, { $set: { fieldBindings: next } });
      bound++;
    }
  }
  log(`  ${tagged} row(s) tagged, ${bound} module binding(s) added.`);

  // ── 3. BOTH PICKERS RESOLVE BY THE TAG ──────────────────────────────────
  // `operator`, not `conjunction`: evalGroupAgainstRecord destructures
  // `{ operator = "AND" }` and ignores `conjunction` entirely, so the existing
  // key was inert - harmless on a one-rule predicate and wrong the moment a
  // second rule lands beside it.
  const predicate = {
    operator: "AND",
    rules: [
      { left: `fields.${bc.id}.value`, comparator: "CONTAINS", right: TAG },
      { left: "meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
    ],
  };
  let rewritten = 0;
  for (const name of PICKERS) {
    const f = fields.find((x) => x.name === name && x.type === "occurrence");
    const cur = f.meta?.optionsSource;
    if (JSON.stringify(cur?.predicate) === JSON.stringify(predicate)) { log(`  ${name}: already scoped by the tag`); continue; }
    log(`  ${name}: ${JSON.stringify(cur?.predicate?.rules?.map((r) => r.comparator))} -> tag + feed guard`);
    if (apply) await Field.updateOne({ id: f.id, gridId: gid },
      { $set: { "meta.optionsSource.predicate": predicate } });
    rewritten++;
  }

  // ── 4. WHAT THE PICKER WILL NOW OFFER — refuse on anything but the four ──
  // Replays the shipped predicate over live data. Without this the migration
  // reports success for a rewrite that resolves to nothing, which on screen is
  // an empty dropdown and a purchase you cannot file.
  // On APPLY this RE-READS Mongo, so the check is on what actually landed
  // rather than on the snapshot taken before the writes. On a dry run there is
  // nothing to read back, so the tag is simulated on the rows it would tag.
  const after = apply
    ? await Occurrence.find({ gridId: gid }).lean()
    : occs.map((o) => (accountIds.has(o.id) && !o.fields?.[bc.id]
        ? { ...o, fields: { ...(o.fields || {}), [bc.id]: { value: shape(TAG) } } } : o));
  const offered = after.filter((o) => {
    if (modById[o.moduleId]?.role !== "instance") return false;
    const v = o.fields?.[bc.id]?.value;
    const hasTag = Array.isArray(v) ? v.includes(TAG) : v === TAG;
    return hasTag && !o.meta?.feedSourceId;
  });
  const names = offered.map(labelOf).sort();
  log(`  the picker now offers ${offered.length}: ${names.join(" · ")}`);

  const missing = [...accountIds].filter((i) => !offered.some((o) => o.id === i));
  if (missing.length)
    throw new Error(`${missing.map((i) => labelOf(occById[i])).join(", ")} would NOT be offered - refusing`);
  const extra = offered.filter((o) => !accountIds.has(o.id));
  if (extra.length)
    throw new Error(`the picker would also offer ${extra.map(labelOf).join(", ")} - refusing`);

  log(`  40 -> ${offered.length}. ${rewritten} picker(s) rewritten.`);
  if (!apply) log("  DRY RUN - pass --apply to write.");
}
