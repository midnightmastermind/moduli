/**
 * 0264 — an occurrence dropdown that offers NOTHING renders its values as raw ids.
 *
 * User, 2026-08-26: *"also all the authors are just ids"*.
 *
 * ── THE DATA WAS PERFECT; THE OPTION LIST WAS EMPTY ─────────────────────
 *
 * Measured on poms grid before writing anything:
 * ```
 * Author  (type occurrence)   538 rows hold a value
 *   values resolving to an occurrence   538      <- nothing dangling
 *   distinct authors referenced         296
 *   carrying occurrence.label           296      <- every name is there
 *   IN the dropdown's own option list     0      <- and this is the bug
 * ```
 * So this is NOT the `0114` class (a reference to a feed copy that got
 * re-minted). Every value resolves and every target has a name. What fails is
 * that the field's `optionsSource.collection` is **`$allInstances`**, and the
 * authors are **`role: "artifact"`** — the book import chose `artifact`
 * deliberately (`0222`, and `0238` inherited it). `optionsResolver`'s
 * COLLECTION_KEYS maps `$allInstances → "instance"`, so the list is role
 * filtered to empty, and a stored value that is not in the option list has no
 * label to render — so the renderer prints the id.
 *
 * **This exact trap is already in CLAUDE.md**, 2026-08-08 (2), reached from the
 * other side: making Location an artifact was rejected because "the dropdown
 * resolves options over `$allInstances`, and that slice is role-filtered —
 * every Location dropdown would have silently resolved to ZERO options." The
 * book import made a field an artifact anyway and nobody re-asked the question.
 *
 * ── IT SWEEPS THE CLASS, NOT THE FIELD ──────────────────────────────────
 *
 * `0239`'s rule: patching the one field found leaves the next import to
 * rediscover it. The planner asks, of EVERY occurrence-typed field: does its
 * collection exclude a role that its own stored values actually use? On poms
 * grid that is exactly one field today (Author) — the other 15 either already
 * use `$allItems` or carry no options source at all — and reporting "1" from a
 * rule that could have found 15 is worth more than patching one by name.
 *
 * ── IT ONLY EVER WIDENS ─────────────────────────────────────────────────
 *
 * The rewrite is always to `$allItems` (COLLECTION_KEYS `"all"`, unfiltered).
 * A field is touched only when its values PROVE the current collection is too
 * narrow, so a correctly-scoped dropdown is never loosened — narrowing one
 * would silently drop options a user can currently pick, which is the damage
 * this migration is trying to undo, in the other direction.
 *
 * The predicate CONDITIONS are untouched: `Board Category CONTAINS "bookAuthor"`
 * is what makes the list authors rather than everything, and it keeps doing so.
 * Only the collection the conditions run OVER gets wider.
 */

export const id = "0264-widen-role-filtered-option-sources";
export const describe =
  "Widens an occurrence field's optionsSource.collection to $allItems when its own stored values are of a role that collection filters out — an empty option list renders every value as a raw id. Only ever widens; never narrows a correctly-scoped dropdown.";
export const touches = ["fields"];

// $allInstances → "instance" etc. Mirrors client/src/helpers/optionsResolver.js
// COLLECTION_KEYS. `all` is unfiltered.
export const COLLECTION_ROLE = {
  $allOccurrences: "all",
  $allItems: "all",
  $allContainers: "container",
  $allPages: "page",
  $allPanels: "panel",
  $allInstances: "instance",
};
export const WIDE = "$allItems";

/**
 * Pure. Which fields have a collection too narrow for their own values?
 *
 * `roleOfOccurrence` is injected rather than derived here so the planner can be
 * tested without a module table.
 */
export function planWidenings({ fields, occurrences, roleOfOccurrence }) {
  const out = [];
  for (const f of fields) {
    if (f.type !== "occurrence") continue;
    const coll = f.meta?.optionsSource?.collection;
    const wantRole = COLLECTION_ROLE[coll];
    // No options source, or already unfiltered — nothing to widen.
    if (!coll || !wantRole || wantRole === "all") continue;

    const rolesUsed = new Map();
    for (const o of occurrences) {
      const raw = o.fields?.[f.id]?.value;
      if (raw == null || raw === "") continue;
      for (const v of Array.isArray(raw) ? raw : [raw]) {
        if (typeof v !== "string") continue;
        const r = roleOfOccurrence(v);
        if (!r) continue; // dangling — a DIFFERENT defect (0114); not ours to fix
        rolesUsed.set(r, (rolesUsed.get(r) || 0) + 1);
      }
    }
    if (!rolesUsed.size) continue;
    const excluded = [...rolesUsed.entries()].filter(([r]) => r !== wantRole);
    if (!excluded.length) continue; // correctly scoped — leave it alone

    out.push({
      fieldId: f.id,
      name: f.name,
      from: coll,
      to: WIDE,
      offeredRole: wantRole,
      excluded: Object.fromEntries(excluded),
      totalValues: [...rolesUsed.values()].reduce((a, b) => a + b, 0),
    });
  }
  return out;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Occurrence, Module } = models;
  const [fields, occurrences, modules] = await Promise.all([
    Field.find({ gridId }).lean(),
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const roleByModule = new Map(modules.map((m) => [m.id, m.role]));
  const roleByOcc = new Map(occurrences.map((o) => [o.id, roleByModule.get(o.moduleId) || null]));
  const roleOfOccurrence = (occId) => roleByOcc.get(occId) || null;

  const plan = planWidenings({ fields, occurrences, roleOfOccurrence });
  if (!plan.length) { log("every occurrence field's collection already covers the roles its values use."); return; }

  for (const p of plan) {
    log(`"${p.name}" (${p.fieldId}) — ${p.from} offers role "${p.offeredRole}" but its ${p.totalValues} value(s) are ${JSON.stringify(p.excluded)} → ${p.to}`);
  }
  if (dryRun) { log("DRY RUN — nothing written."); return; }

  for (const p of plan) {
    await Field.updateOne(
      { gridId, id: p.fieldId },
      { $set: { "meta.optionsSource.collection": p.to } }
    );
  }
  log(`widened ${plan.length} field option source(s).`);
}
