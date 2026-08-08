// server/migrations/0054-place-becomes-location.mjs
//
// `Place` becomes `Location`, and `Address` becomes a real ADDRESS field.
//
// User's ask, 2026-08-08, refined across six messages:
//   "change place to location then" / "and have it do addresses" /
//   "with an address search box if possible for the add new" /
//   "address field type i mean too" /
//   "location is a dropdown of occurances with address type in the locations
//    container"
//
// ── WHAT THIS IS AND IS NOT ─────────────────────────────────────────────────
//
// There is NO `location` field type, and that was a deliberate reversal. The
// SEARCHABLE thing is the address, so the new type is `address` and it owns the
// map-search editor. "Location" stays exactly what `Place` already was — an
// ordinary occurrence dropdown into a container of options — and gains nothing
// but a better name. The work is on the OPTIONS: each one can now carry a
// searchable address.
//
// Also considered and REJECTED (user: "i feel like mixing it into files is
// dirty"): making a location an ARTIFACT kind. An artifact is a file and Files
// is the folder of files; a place is neither. It would also have flipped
// locations to `role: "artifact"`, and the dropdown resolves its options over
// `$allInstances` — which is ROLE-FILTERED — so every Location dropdown would
// have silently resolved to zero options.
//
// ── EVERYTHING RESOLVES BY NAME **AND TYPE** ────────────────────────────────
//
// Never by baked id. This grid has two fields called "Due" (a display-only
// number tile and the real date), which is the precedent for why name alone is
// not an identity: it picks whichever Mongo returns first. Every lookup here
// carries the type as well.
//
// ── IT INVENTS NO ADDRESSES, AND THAT IS THE POINT ──────────────────────────
//
// Dewey Center and Froedtert are added as Location options with their NAMES and
// NOTHING ELSE. I probed both real geocoders for them:
//
//   "Froedtert"                       photon OK    nominatim OK
//   "Dewey Center Milwaukee"          photon MISS  nominatim MISS
//
// Dewey Center is not in OpenStreetMap under that name, so there is no address
// to write that would not be a guess. And while the geocoder does return
// "Froedtert Hospital, 9200 West Wisconsin Avenue", the user's appointment is a
// peer support group — Froedtert has several campuses and I do not know which.
// **A plausible-looking address on a medical appointment is indistinguishable
// from one the user entered, will be trusted, and may send them to the wrong
// building.** Same rule 0052 applied to phone numbers. Both are left blank for
// the user to fill with the new search box, which takes two clicks.
//
// ── IDEMPOTENT ──────────────────────────────────────────────────────────────
//
// Every step checks for its own result first. The rename is a no-op once the
// field is called Location; the options are matched by name AMONG THE BOARD'S
// OWN CHILDREN (a global name match would let some unrelated "Froedtert"
// elsewhere on the grid decide the option already existed — 0035's selector
// class, and the same scoping 0052 used).

export const id = "0054-place-becomes-location";

const uid = () => (globalThis.crypto?.randomUUID?.()
  || `l-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

/** What the user actually told us. Nothing beyond this is written. */
const NEW_LOCATIONS = [
  { name: "Dewey Center", note: "Therapy sessions with Keith." },
  { name: "Froedtert", note: "Peer support group." },
];

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Field } = models;

  // ── 1. The fields, resolved by NAME AND TYPE ─────────────────────────────
  const fields = await Field.find({ gridId }).lean();
  const byName = (name) => fields.filter(
    (f) => (f.name || "").trim().toLowerCase() === name,
  );

  const placeMatches = byName("place").filter((f) => f.type === "occurrence");
  const locationMatches = byName("location");
  const addressMatches = byName("address").filter(
    (f) => f.type === "text" || f.type === "address",
  );

  if (locationMatches.length && !placeMatches.length) {
    log("field is already named Location — rename already applied");
  } else if (locationMatches.length && placeMatches.length) {
    // The standing unique-field-names rule (2026-07-14) makes this a real
    // conflict, not a merge decision a migration should make on its own.
    log(`REFUSING: both "Place" and "Location" exist (${placeMatches.length} + ${locationMatches.length}).`);
    log("  Renaming would create two fields with the same name. Resolve by hand.");
    return;
  } else if (placeMatches.length > 1) {
    log(`REFUSING: ${placeMatches.length} occurrence-typed fields named "Place" — ambiguous.`);
    return;
  }

  const placeField = placeMatches[0] || locationMatches[0] || null;
  const addressField = addressMatches[0] || null;

  if (!placeField) {
    log("no Place/Location field on this grid — nothing to rename");
  }
  if (!addressField) {
    log("no Address field on this grid — the address half will be skipped");
  }

  // ── 2. Rename Place → Location ───────────────────────────────────────────
  if (placeField && (placeField.name || "").trim().toLowerCase() === "place") {
    log(`RENAME field  Place → Location  (${placeField.id})`);
    if (!dryRun) {
      await Field.updateOne({ gridId, id: placeField.id }, { $set: { name: "Location" } });
    }
  }

  // ── 3. Address becomes the `address` TYPE ────────────────────────────────
  // The stored VALUES are untouched. A plain string stays a perfectly good
  // address; the client reads both shapes and only the picker writes the
  // richer one. Geocoding the 10 existing People addresses to "upgrade" them
  // would be rewriting the user's own data on a guess.
  if (addressField && addressField.type !== "address") {
    const valued = await Occurrence.countDocuments({
      gridId, [`fields.${addressField.id}`]: { $exists: true },
    });
    log(`RETYPE field  Address  text → address  (${addressField.id}); ${valued} existing values left as-is`);
    if (!dryRun) {
      await Field.updateOne({ gridId, id: addressField.id }, { $set: { type: "address" } });
    }
  } else if (addressField) {
    log("Address is already the address type");
  }

  // ── 4. Find the options container the dropdown points at ─────────────────
  // From the dropdown's OWN addNew target rather than by container label: that
  // is the container the field actually mints into, so it cannot disagree with
  // itself. Falls back to a label lookup for a grid whose field predates addNew.
  const src = placeField?.meta?.optionsSource || null;
  let boardOcc = null;
  const addNewTarget = src?.addNew?.parentOccurrenceId
    || (Array.isArray(src?.addNew?.targets) ? src.addNew.targets[0] : null);

  if (addNewTarget) {
    boardOcc = await Occurrence.findOne({ gridId, id: addNewTarget }).lean();
  }
  if (!boardOcc) {
    const mods = await Module.find({
      gridId, role: "container", label: { $in: [/^places$/i, /^locations$/i] },
    }).lean();
    if (mods.length) {
      const cands = await Occurrence.find({
        gridId, moduleId: { $in: mods.map((m) => m.id) },
      }).lean();
      boardOcc = cands.sort(
        (a, b) => (b.occurrences?.length || 0) - (a.occurrences?.length || 0),
      )[0] || null;
    }
  }

  if (!boardOcc) {
    log("could not locate the Places/Locations options container — skipping the option work");
    return;
  }
  const optionIds = boardOcc.occurrences || [];
  log(`options container ${boardOcc.id} — ${optionIds.length} options`);

  // ── 5. Rename the board itself, container AND page ───────────────────────
  // Both, because the page is what the user navigates to and the container is
  // what the dropdown mints into; renaming one leaves the pair disagreeing.
  const boardMods = await Module.find({
    gridId, label: { $in: [/^places$/i] },
  }).lean();
  for (const m of boardMods) {
    log(`RENAME ${m.role}  ${m.label} → Locations  (${m.id})`);
    if (!dryRun) await Module.updateOne({ gridId, id: m.id }, { $set: { label: "Locations" } });
  }
  if (!boardMods.length) log("board modules already named Locations (or absent)");

  // ── 6. Bind Address on every option, so a place can HOLD one ─────────────
  // Binding is the half that is easy to forget and impossible to work around:
  // without it there is no control to type an address into, and a value written
  // by anything else would be invisible. (0047 recorded exactly this trap.)
  const existingOptions = optionIds.length
    ? await Occurrence.find({ gridId, id: { $in: optionIds } }).lean()
    : [];
  const optionMods = existingOptions.length
    ? await Module.find({ gridId, id: { $in: existingOptions.map((o) => o.moduleId) } }).lean()
    : [];

  if (addressField) {
    let bound = 0;
    for (const m of optionMods) {
      const bindings = m.fieldBindings || [];
      if (bindings.some((b) => b.fieldId === addressField.id)) continue;
      const next = [...bindings, {
        fieldId: addressField.id,
        role: "input",
        order: bindings.length,
      }];
      log(`BIND   Address on option "${m.label}"`);
      if (!dryRun) {
        await Module.updateOne({ gridId, id: m.id }, { $set: { fieldBindings: next } });
      }
      bound++;
    }
    log(bound ? `bound Address on ${bound} option module(s)` : "every option already binds Address");
  }

  // ── 7. Show the address IN the dropdown rows ─────────────────────────────
  // User: "we should have in a dropdown of occurances, what fields get shown in
  // the dropdown … like in the settings for that field."
  //
  // That mechanism ALREADY EXISTS — `optionsSource.chipDisplay` (2026-05-19),
  // editable per field in the Command Center. Nothing new was built for it;
  // this only turns it on for Location, so each row reads as a name with its
  // address beneath. `showMedia: false` because a place has no picture and the
  // empty media slot would just indent every row.
  if (placeField && addressField) {
    const already = src?.chipDisplay?.fieldIds?.includes(addressField.id);
    if (already) {
      log("dropdown rows already show the address");
    } else {
      log("CONFIG dropdown rows to show each location's Address under its name");
      if (!dryRun) {
        await Field.updateOne({ gridId, id: placeField.id }, {
          $set: {
            "meta.optionsSource.chipDisplay": {
              fieldIds: [addressField.id],
              showLabel: true,
              showMedia: false,
            },
          },
        });
      }
    }
  }

  // ── 8. The two real places, NAMES ONLY ───────────────────────────────────
  const exemplarOcc = existingOptions.find((o) => o.moduleId) || null;
  const exemplarMod = exemplarOcc
    ? optionMods.find((m) => m.id === exemplarOcc.moduleId)
    : null;

  if (!exemplarMod) {
    log("no exemplar option to copy the shape from — refusing to invent one");
    return;
  }

  // The identity tags an option must carry to be found by the dropdown's own
  // predicate at all. Read off a KNOWN-GOOD sibling rather than named here, so
  // a retag cannot strand the new options outside their own board.
  const exFields = exemplarOcc.fields || {};
  const tagFields = {};
  for (const [fid, v] of Object.entries(exFields)) {
    const val = v?.value;
    const isTag = typeof val === "string"
      || (Array.isArray(val) && val.every((x) => typeof x === "string"));
    if (isTag && fid !== addressField?.id) tagFields[fid] = { ...v };
  }
  // The exemplar was read BEFORE step 6 bound Address, so its in-memory copy is
  // the pre-bind shape. Copying it verbatim gave the new locations no Address
  // binding at all — they existed and could not hold the one thing they are for.
  // Caught by verifying the RESULT rather than trusting the step's own log.
  const optionBindings = [...(exemplarMod.fieldBindings || [])];
  if (addressField && !optionBindings.some((b) => b.fieldId === addressField.id)) {
    optionBindings.push({ fieldId: addressField.id, role: "input", order: optionBindings.length });
  }
  log(`copying the shape of "${exemplarMod.label}" — ${optionBindings.length} bindings (Address included), ${Object.keys(tagFields).length} identity tag(s)`);

  const existingNames = new Set(
    optionMods.map((m) => (m.label || "").trim().toLowerCase()).filter(Boolean),
  );
  const notesField = fields.find(
    (f) => (f.name || "").toLowerCase() === "person notes",
  ) || null;

  const newIds = [];
  const stamp = () => ({ flow: "in", timestamp: new Date().toISOString() });

  for (const loc of NEW_LOCATIONS) {
    if (existingNames.has(loc.name.toLowerCase())) {
      log(`SKIP   ${loc.name} — already on the Locations board`);
      continue;
    }
    const modId = uid();
    const occId = uid();
    log(`ADD    ${loc.name}  (module ${modId})  — address intentionally EMPTY`);

    if (dryRun) { newIds.push(occId); continue; }

    await new Module({
      id: modId, userId: boardOcc.userId, gridId,
      role: "instance",
      label: loc.name,
      defaultDragMode: "copy",
      fieldBindings: optionBindings,
    }).save();

    await new Occurrence({
      id: occId, userId: boardOcc.userId, gridId,
      moduleId: modId,
      targetId: modId, targetType: "module",
      parentId: boardOcc.id,
      fields: {
        ...tagFields,
        ...(notesField ? { [notesField.id]: { value: loc.note, ...stamp() } } : {}),
      },
      occurrences: [],
    }).save();

    newIds.push(occId);
  }

  if (!newIds.length) {
    log("nothing to add — both locations already present");
    return;
  }

  // `$push` with a `$ne` guard, never a whole-array write: the array is the
  // render order and a read-modify-write races every other writer.
  if (!dryRun) {
    for (const occId of newIds) {
      await Occurrence.updateOne(
        { gridId, id: boardOcc.id, occurrences: { $ne: occId } },
        { $push: { occurrences: occId } },
      );
    }
  }
  log(`linked ${newIds.length} new location(s) into the board`);
}
