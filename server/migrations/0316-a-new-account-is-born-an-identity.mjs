// An account added from the dropdown must not put an empty row back.
//
// 0313 took the four account rows off the Financial group: an account is an
// identity a transaction points at, not a tile. "+ Add new" on the two account
// pickers still minted a VISIBLE row, so creating one put back exactly what the
// user asked to remove — *"i dont want these empty rows"*.
//
// `addNew.hidden` is the declaration, read by `createOptionUnderParent` and
// passed to `createLeafInstanceInParent`. Nothing is hardcoded: any dropdown
// whose options are identities can say so, and every other picker is unchanged
// because the flag is absent there.
//
// THE SERVER ALREADY CARRIED IT. `create_occurrence` forwards `hidden` when the
// payload declares it (`crud.js`, beside the same forwarding for
// locked/sortOrder/dragMode) — so this needed the client to SAY it, not a new
// path through the shared create. That was worth checking rather than assuming:
// the estimate before reading it was "helper, emit, reducer, server handler".
//
// Idempotent.
import Field from "../models/Field.js";

export const id = "0316-a-new-account-is-born-an-identity";
export const description = "Accounts added from the account pickers are born hidden.";
export const touches = ["fields"];

const PICKERS = ["Account", "To Account"];

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);
  const fields = await Field.find({ gridId: gid }).lean();

  let changed = 0;
  for (const name of PICKERS) {
    const hits = fields.filter((f) => f.name === name && f.type === "occurrence");
    if (hits.length !== 1) throw new Error(`"${name}" is ambiguous or missing (${hits.length}) - refusing`);
    const f = hits[0];
    const addNew = f.meta?.optionsSource?.addNew;
    // A picker with no add-new destination has nothing to declare, and forcing
    // one would invent a place for new accounts to land.
    if (!addNew || !(addNew.parentOccurrenceId || (addNew.targets || []).length))
      throw new Error(`"${name}" has no add-new destination - refusing`);
    if (addNew.hidden === true) { log(`  ${name}: already mints hidden options`); continue; }
    log(`  ${name}: new options will be born hidden`);
    if (apply) await Field.updateOne({ id: f.id, gridId: gid },
      { $set: { "meta.optionsSource.addNew.hidden": true } });
    changed++;
  }

  // THE CONTROL: no OTHER dropdown may gain this. A picker whose options are
  // things you look at (ingredients, movements, meals) must keep minting
  // visible rows, and a blanket flag would silently hide every one of them.
  const others = fields.filter(
    (f) => !PICKERS.includes(f.name) && f.meta?.optionsSource?.addNew?.hidden === true);
  if (others.length)
    throw new Error(`${others.map((f) => f.name).join(", ")} also mint hidden options - refusing`);
  log(`  ${fields.filter((f) => f.meta?.optionsSource?.addNew).length - changed} other add-new picker(s) still mint visible rows`);

  log(`  ${changed} picker(s) ${apply ? "updated" : "would be updated"}.`);
  if (!apply) log("  DRY RUN - pass --apply to write.");
}
