// Put back the three account balances the pre-fix teardown destroyed.
//
// `2026-09-08 (2)` measured the day-column teardown removing **137 occurrences,
// 31 of them COMPLETED**, including *"6 Track (the account balances)"*, and
// `b26430d4` stopped it recurring. It did not put back what had already gone —
// so all four balances have read **$0** ever since, verified on prod:
//
//     Accounts    Checking $0 · Savings $0 · Mom's $0 · Cash $0
//     Monthly Bills $2040.97          <- the CONTROL, in the same container:
//                                        tracker ops compute and paint fine,
//                                        so the zeros are missing DATA
//
// Measured rather than inferred: of 25 money rows on the grid, **not one is
// both dated and completed** — the 25 are the catalogue action rows, which the
// Schedule scope gate correctly excludes. There is nothing for the balance ops
// to count.
//
// ── A RESTORE, NOT A RECONSTRUCTION ───────────────────────────────────────
//
// The three rows below are copied VERBATIM out of
// `backups/poms-grid/2026-09-06T23-58-29-832Z_pre-migration-0313-…`, keeping
// their ORIGINAL ids — that is what makes this a restore and what makes it
// idempotent for free (a second run finds them and stops). Their amounts match
// the figures CLAUDE.md recorded independently on 2026-09-07:
//
//     Savings  123.14 · Checking 4.16 · Cash 17     Net Worth 144.30 = the sum
//
// The backup holds SIX such rows; three are Schedule Table FEED COPIES, which
// `feedSync` regenerates on its own from the sources. Minting them here would
// fight the engine that owns them (2026-08-13).
//
// **Only the parent moves.** Their 7:00am slot went with the 09-06 column, so
// they are re-homed into today's 7:00am slot — parented AND listed, because a
// parent renders `occurrences[]` and a parented-but-unlisted row is invisible
// (the class this repo has repaired from six directions). The DATE stays
// 2026-09-06: it is when the balance was actually set, and `current` semantics
// surface it on every later day anyway.
//
// ── IT REFUSES RATHER THAN OVERWRITE ──────────────────────────────────────
//
// If any balance is already non-zero, the user has set one since and a stale
// number that looks authoritative is worse than a zero. If any of the three ids
// is already present, it has been restored. Either way: refuse.
import mongoose from "mongoose";
import Grid from "../models/Grid.js";
import Occurrence from "../models/Occurrence.js";
import Module from "../models/Module.js";
import Field from "../models/Field.js";

export const id = "0328-put-back-the-balances-the-teardown-destroyed";
export const description = "Restores the three Track rows (Checking 4.16, Savings 123.14, Cash 17) the pre-fix day-column teardown deleted.";
export const touches = ["occurrences"];

/** Verbatim from the 2026-09-06T23:58 backup, minus the dead parentId. */
const ROWS = [
  {
    "id": "1788716321099-1at2ujhf3",
    "userId": "699bbdfbf62b06018225b91a",
    "dragMode": null,
    "feed": null,
    "fieldUpdatedAt": {
      "ln5jN--HJI3T": 1788716463013,
      "CvJsK3lNu6_e": 1788716463013,
      "Eh7oi4HKdbHB": 1788716463013,
      "nSccAtADyUGW": 1788716463013,
      "XeKiw-azlD8_": 1788716463013,
      "UaTvV4PKkI1-": 1788716463013,
      "tZWiPDQUDP74": 1788716463013,
      "11fb553d-fe64-47e2-841f-0235529ccb08": 1788716463013
    },
    "fieldVisibility": null,
    "fields": {
      "ln5jN--HJI3T": {
        "value": 123.14,
        "flow": "replace"
      },
      "CvJsK3lNu6_e": {
        "value": [
          "financial"
        ],
        "flow": "in"
      },
      "Eh7oi4HKdbHB": {
        "value": "2026-09-06",
        "flow": "in"
      },
      "nSccAtADyUGW": {
        "value": "7:00am",
        "flow": "replace",
        "timestamp": 1788716322332
      },
      "XeKiw-azlD8_": {
        "value": "2026-09-06",
        "flow": "replace",
        "timestamp": 1788716322344
      },
      "UaTvV4PKkI1-": {
        "value": "cjNNbuGELFGz",
        "flow": "in"
      },
      "tZWiPDQUDP74": {
        "value": true,
        "flow": "in"
      },
      "11fb553d-fe64-47e2-841f-0235529ccb08": {
        "value": "2026-09-06",
        "flow": "replace",
        "timestamp": 1788716459330
      }
    },
    "filterNavConfig": {},
    "filterOverride": null,
    "filters": [],
    "gridId": "6a690f6fb8e785df961a9f3c",
    "hidden": false,
    "identitySignature": null,
    "label": null,
    "linkedGroupId": "1788716321099-1at2ujhf3",
    "locked": false,
    "meta": {},
    "moduleId": "0it_W2VYcDlw",
    "occurrences": [],
    "ownStyle": null,
    "sortOrder": 0,
    "textmap": null,
    "viewId": null
  },
  {
    "id": "1788716541907-zk1ww9qdp",
    "userId": "699bbdfbf62b06018225b91a",
    "dragMode": null,
    "feed": null,
    "fieldUpdatedAt": {
      "ln5jN--HJI3T": 1788716547488,
      "CvJsK3lNu6_e": 1788716547488,
      "tZWiPDQUDP74": 1788716547488,
      "11fb553d-fe64-47e2-841f-0235529ccb08": 1788716547488,
      "UaTvV4PKkI1-": 1788716547488,
      "Eh7oi4HKdbHB": 1788716547488,
      "nSccAtADyUGW": 1788716547488,
      "XeKiw-azlD8_": 1788716547488
    },
    "fieldVisibility": null,
    "fields": {
      "ln5jN--HJI3T": {
        "value": 4.16,
        "flow": "replace"
      },
      "CvJsK3lNu6_e": {
        "value": [
          "financial"
        ],
        "flow": "in"
      },
      "tZWiPDQUDP74": {
        "value": true,
        "flow": "in"
      },
      "11fb553d-fe64-47e2-841f-0235529ccb08": {
        "value": "2026-09-06",
        "flow": "replace",
        "timestamp": 1788716471602
      },
      "UaTvV4PKkI1-": {
        "value": "HdoUL_NCmI03",
        "flow": "in"
      },
      "Eh7oi4HKdbHB": {
        "value": "2026-09-06",
        "flow": "in"
      },
      "nSccAtADyUGW": {
        "value": "7:00am",
        "flow": "replace",
        "timestamp": 1788716543624
      },
      "XeKiw-azlD8_": {
        "value": "2026-09-06",
        "flow": "replace",
        "timestamp": 1788716543634
      }
    },
    "filterNavConfig": {},
    "filterOverride": null,
    "filters": [],
    "gridId": "6a690f6fb8e785df961a9f3c",
    "hidden": false,
    "identitySignature": null,
    "label": null,
    "linkedGroupId": "1788716541907-zk1ww9qdp",
    "locked": false,
    "meta": {},
    "moduleId": "0it_W2VYcDlw",
    "occurrences": [],
    "ownStyle": null,
    "sortOrder": 0,
    "textmap": null,
    "viewId": null
  },
  {
    "userId": "699bbdfbf62b06018225b91a",
    "id": "1788716637184-lud3irv2m",
    "dragMode": null,
    "feed": null,
    "fieldUpdatedAt": {
      "ln5jN--HJI3T": 1788716642434,
      "CvJsK3lNu6_e": 1788716642434,
      "tZWiPDQUDP74": 1788716642434,
      "11fb553d-fe64-47e2-841f-0235529ccb08": 1788716642434,
      "UaTvV4PKkI1-": 1788716642434,
      "Eh7oi4HKdbHB": 1788716642434,
      "nSccAtADyUGW": 1788716642434,
      "XeKiw-azlD8_": 1788716642434
    },
    "fieldVisibility": null,
    "fields": {
      "ln5jN--HJI3T": {
        "value": 17,
        "flow": "replace"
      },
      "CvJsK3lNu6_e": {
        "value": [
          "financial"
        ],
        "flow": "in"
      },
      "tZWiPDQUDP74": {
        "value": true,
        "flow": "in"
      },
      "11fb553d-fe64-47e2-841f-0235529ccb08": {
        "value": "2026-09-06",
        "flow": "replace",
        "timestamp": 1788716471602
      },
      "UaTvV4PKkI1-": {
        "value": "o022Dkuz4OTS",
        "flow": "in"
      },
      "Eh7oi4HKdbHB": {
        "value": "2026-09-06",
        "flow": "in"
      },
      "nSccAtADyUGW": {
        "value": "7:00am",
        "flow": "replace",
        "timestamp": 1788716638553
      },
      "XeKiw-azlD8_": {
        "value": "2026-09-06",
        "flow": "replace",
        "timestamp": 1788716638563
      }
    },
    "filterNavConfig": {},
    "filterOverride": null,
    "filters": [],
    "gridId": "6a690f6fb8e785df961a9f3c",
    "hidden": false,
    "identitySignature": null,
    "label": null,
    "linkedGroupId": "1788716637184-lud3irv2m",
    "locked": false,
    "meta": {},
    "moduleId": "0it_W2VYcDlw",
    "occurrences": [],
    "ownStyle": null,
    "sortOrder": 0,
    "textmap": null,
    "viewId": null
  }
];

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const [occs, mods, flds] = await Promise.all([
    Occurrence.find({ gridId: gid }).lean(),
    Module.find({ gridId: gid }).lean(),
    Field.find({ gridId: gid }).lean(),
  ]);
  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const occById = Object.fromEntries(occs.map((o) => [o.id, o]));
  const labelOf = (o) => o?.label || modById[o?.moduleId]?.label || "(unlabeled)";
  const one = (n) => {
    const hits = flds.filter((f) => f.name === n);
    if (hits.length !== 1) throw new Error(`field "${n}" is ambiguous or missing (${hits.length}) - refusing`);
    return hits[0].id;
  };
  const DATE = one("Date"), SLOT = one("Time Slot"), ACCT = one("Account"), DONE = one("Completed");

  // 1. ALREADY RESTORED?
  const present = ROWS.filter((r) => occById[r.id]);
  if (present.length) { log(`  ${present.length} of ${ROWS.length} already on the grid - nothing to do.`); return; }

  // 2. HAS A BALANCE BEEN SET SINCE? Then this data is stale and must not land.
  const acctTile = occs.find((o) => labelOf(o) === "Accounts" && modById[o.moduleId]?.role === "instance");
  if (!acctTile) throw new Error("no Accounts tile - refusing");
  const balNames = ["Checking Balance", "Savings Balance", "Cash", "Mom's Account"];
  const nonZero = [];
  for (const n of balNames) {
    for (const f of flds.filter((x) => x.name === n)) {
      const v = acctTile.fields?.[f.id]?.value;
      if (v != null && Number(v) !== 0) nonZero.push(`${n}=${v}`);
    }
  }
  if (nonZero.length)
    throw new Error(`a balance is already set (${nonZero.join(", ")}) - this restore is stale; refusing`);

  // 3. THE DESTINATION — today's Schedule column, the slot these rows named.
  const wantSlot = ROWS[0].fields[SLOT]?.value;
  if (!wantSlot) throw new Error("the backup rows carry no Time Slot - refusing");
  const schedPage = occs.find((o) => labelOf(o) === "Schedule" && modById[o.moduleId]?.role === "page");
  if (!schedPage) throw new Error("no Schedule page - refusing");
  const cols = (schedPage.occurrences || []).map((i) => occById[i]).filter(Boolean);
  if (cols.length !== 1)
    throw new Error(`expected exactly 1 Schedule day column, found ${cols.length} - refusing`);
  const slot = (cols[0].occurrences || []).map((i) => occById[i])
    .filter(Boolean).find((c) => c.fields?.[SLOT]?.value === wantSlot);
  if (!slot) throw new Error(`no "${wantSlot}" slot under ${labelOf(cols[0])} - refusing`);
  log(`  destination: "${wantSlot}" under ${labelOf(cols[0])} (${slot.id})`);

  // 4. Each row must still name a real account, or it restores a dangling pick.
  for (const r of ROWS) {
    const a = r.fields[ACCT]?.value;
    if (!a || !occById[a]) throw new Error(`row ${r.id} names account ${a}, which is not on the grid - refusing`);
    log(`  ${labelOf(occById[a]).padEnd(18)} ${r.fields[Object.keys(r.fields).find((k) => r.fields[k].flow === "replace" && typeof r.fields[k].value === "number")].value}`
      + `  date=${r.fields[DATE]?.value}  completed=${r.fields[DONE]?.value}`);
  }

  if (!apply) { log(`  ${ROWS.length} row(s) would be restored.\n  DRY RUN - pass --apply to write.`); return; }

  // 5. WRITE. Parent AND list, or the row exists and renders nowhere.
  for (const r of ROWS) await Occurrence.create({ ...r, gridId: gid, parentId: slot.id });
  await Occurrence.updateOne({ id: slot.id, gridId: gid },
    { $push: { occurrences: { $each: ROWS.map((r) => r.id) } } });

  // 6. CONTROLS — read back out of Mongo, never off the log above.
  const after = await Occurrence.find({ gridId: gid, id: { $in: ROWS.map((r) => r.id) } }).lean();
  if (after.length !== ROWS.length) throw new Error(`restored ${after.length} of ${ROWS.length} - refusing`);
  const slotAfter = await Occurrence.findOne({ id: slot.id, gridId: gid }).lean();
  const listed = ROWS.filter((r) => (slotAfter.occurrences || []).includes(r.id)).length;
  if (listed !== ROWS.length) throw new Error(`${ROWS.length - listed} row(s) parented but NOT listed - refusing`);
  const accounts = new Set(after.map((o) => o.fields?.[ACCT]?.value));
  if (accounts.size !== ROWS.length) throw new Error(`rows do not name distinct accounts - refusing`);
  for (const o of after) {
    if (o.fields?.[DONE]?.value !== true) throw new Error(`${o.id} is not completed - refusing`);
    if (!o.fields?.[DATE]?.value) throw new Error(`${o.id} carries no date - refusing`);
    if (o.meta?.feedSourceId) throw new Error(`${o.id} looks like a feed copy - refusing`);
  }
  log(`  ${after.length} restored, ${listed} listed by the slot, ${accounts.size} distinct accounts, all completed + dated.`);
}
