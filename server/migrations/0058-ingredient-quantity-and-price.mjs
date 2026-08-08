// server/migrations/0058-ingredient-quantity-and-price.mjs
//
// USER 2026-08-07: "we also need an amount category for ingredients so ik how
// much. also we need those linked to a grocery list, with amount and prices for
// each item."
//
// ── HALF OF THIS WAS ALREADY BUILT ──────────────────────────────────────────
//
// Measured before writing anything: **30 options already carry BOTH the
// "ingredient" and "grocery" tags**, and both boards are feed-backed on Board
// Category — so an item already materializes on the other board. The "linked to
// a grocery list" half needs nothing. What is missing is per-item quantity and
// price, and that is all this does.
//
// ── WHY NOT REUSE `Amount` ──────────────────────────────────────────────────
//
// `Amount` is the money field and it is load-bearing: **27 modules bind it and
// 8 operations sum it** (Spent, Checking Balance, Mom's/Cash Balance, Total
// Subscriptions, Monthly Bills, Purchase History, Due: Seed). Putting "300 g"
// of chicken in it would add 300 to the spending total and drop the checking
// balance by 300. Quantity gets its own field.
//
// ── QUANTITY CARRIES A UNIT LIST; PRICE DELIBERATELY DOES NOT ───────────────
//
// Quantity uses the per-row affix picker (`postfixOptions`, shipped 2026-08-08)
// so one field covers g / kg / ml / L / oz / lb / count — the user's ask, "kg ml
// g any for amount of ingrediants".
//
// **Price is a fixed `$` with NO currency options, on purpose.** The affix is
// presentation only — it never changes the number — so a list of currencies on
// a field that gets TOTALLED would let £ and $ rows add together into a number
// that means nothing. Units on Quantity are safe because nothing sums Quantity
// across items; a mixed-currency Price total would be silently wrong. Same
// reasoning that keeps grams off Amount, applied one level down.
//
// ── AND PRICE IS NOT A TRANSACTION ──────────────────────────────────────────
//
// Price is a SHELF PRICE — what the thing costs. It is deliberately not read by
// any money tracker: buying groceries is already recorded by the Buy/Spend
// occurrences that carry Amount. If Price fed Spent too, every shop would be
// counted twice.

export const id = "0058-ingredient-quantity-and-price";

const uid = () => (globalThis.crypto?.randomUUID?.()
  || `q-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

const QUANTITY_UNITS = ["g", "kg", "ml", "L", "oz", "lb", "count"];

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Field } = models;

  const fields = await Field.find({ gridId }).lean();
  const byName = (n, type) => fields.find(
    (f) => (f.name || "").trim().toLowerCase() === n.toLowerCase() && (!type || f.type === type),
  );

  const boardCategory = byName("Board Category", "select");
  if (!boardCategory) { log("REFUSING: no Board Category field"); return; }

  // Land the new fields in the same drawer as the macros they sit beside, read
  // off an existing sibling rather than named here — a hardcoded folder id
  // would be a snapshot of today's layout.
  const calories = byName("Calories", "number");
  const folderId = calories?.folderId ?? null;
  log(`field category: ${folderId || "(none)"} — copied from Calories`);

  // ── 1. The two fields ────────────────────────────────────────────────────
  const wanted = [
    {
      name: "Quantity",
      spec: {
        type: "number", inputEnabled: true, displayEnabled: false, folderId,
        // No fixed postfix — the row picks. A default would show on every item
        // that has not chosen yet, which reads as a claim.
        meta: { postfixOptions: QUANTITY_UNITS, increment: 1, min: 0 },
      },
    },
    {
      name: "Price",
      spec: {
        type: "number", inputEnabled: true, displayEnabled: false, folderId,
        meta: { prefix: "$", increment: 1, min: 0 },
      },
    },
  ];

  const resolved = {};
  for (const { name, spec } of wanted) {
    const existing = byName(name);
    if (existing) {
      resolved[name] = existing;
      log(`SKIP   field "${name}" already exists (${existing.id}, type=${existing.type})`);
      continue;
    }
    const id = uid();
    resolved[name] = { id, name, ...spec };
    log(`ADD    field "${name}"  ${spec.type}${spec.meta.postfixOptions ? `  units: ${spec.meta.postfixOptions.join(" ")}` : ""}${spec.meta.prefix ? `  prefix: ${spec.meta.prefix}` : ""}`);
    if (!dryRun) {
      const userId = (await Occurrence.findOne({ gridId }).lean())?.userId;
      await new Field({ id, userId, gridId, name, ...spec }).save();
    }
  }

  // ── 2. Bind them on every grocery/ingredient option ──────────────────────
  // DERIVED FROM THE TAG, never a list of labels — the boards gain items and a
  // hardcoded list would go stale the first time one is added.
  const all = await Occurrence.find({ gridId }).lean();
  const isTagged = (o, tag) => {
    const v = o.fields?.[boardCategory.id]?.value;
    return Array.isArray(v) ? v.includes(tag) : v === tag;
  };
  // FEED COPIES ARE SKIPPED: feedSync re-mints them from the source, so a
  // binding written on a copy is a write to something about to be overwritten.
  const tagged = all.filter(
    (o) => !o.meta?.feedSourceId && (isTagged(o, "ingredient") || isTagged(o, "grocery")),
  );
  const taggedMods = await Module.find({
    gridId, id: { $in: tagged.map((o) => o.moduleId) },
  }).lean();
  const modById = Object.fromEntries(taggedMods.map((m) => [m.id, m]));

  // **THE BOARD ITSELF CARRIES THE TAG.** Every option-board container holds its
  // own Board Category value — that is the documented mechanism the addNew flow
  // reads to stamp new options. So a tag-derived sweep picks up "Grocery List"
  // alongside the groceries, and the dry run showed exactly that. An item is an
  // INSTANCE; the board is a CONTAINER. Caught by reading the named list, not
  // the count — a count of 18 looked perfectly reasonable.
  const sources = tagged.filter((o) => (modById[o.moduleId]?.role) === "instance");
  const skipped = tagged.length - sources.length;
  const mods = taggedMods.filter((m) => m.role === "instance");
  log(`${sources.length} source option(s) carrying the ingredient/grocery tag`
    + ` (feed copies skipped; ${skipped} non-instance skipped — the board container carries the tag too)`);

  let bound = 0;
  for (const m of mods) {
    const bindings = [...(m.fieldBindings || [])];
    let changed = false;
    for (const name of ["Quantity", "Price"]) {
      const fid = resolved[name].id;
      if (bindings.some((b) => b.fieldId === fid)) continue;
      bindings.push({ fieldId: fid, role: "input", order: bindings.length });
      changed = true;
    }
    if (!changed) continue;
    bound++;
    if (bound <= 5) log(`BIND   Quantity + Price on "${m.label}"`);
    if (!dryRun) {
      await Module.updateOne({ gridId, id: m.id }, { $set: { fieldBindings: bindings } });
    }
  }
  log(bound > 5 ? `         …and ${bound - 5} more` : "");
  log(bound ? `bound on ${bound} option module(s)` : "every option already binds both");
}
