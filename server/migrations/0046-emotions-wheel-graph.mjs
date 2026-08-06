// server/migrations/0046-emotions-wheel-graph.mjs
//
// The Emotions Wheel becomes a thing you can look at and click.
//
// 0044 put the 128 emotions on a board in the Library; 0045 pointed `Mood` at
// them. This mints the GRAPH that draws them and the OPERATION that decides
// what a click means — the last two pieces of the user's ask (2026-08-06):
//
//   "the goal is to create a feeling wheel of emotions and when i select an
//    emotion, it records the mood."
//
// THE GRAPH KNOWS NOTHING ABOUT EMOTIONS, and that is the whole design. It is
// an ordinary `kind:"graph"` container whose ROWS ARE ITS CHILDREN, and its
// children arrive by the ordinary FEED mechanism — the same query engine the
// Schedule Table uses. Three pieces of configuration do all the work:
//
//   feed          → pull every occurrence tagged `emotion` (the same
//                   boardCategory predicate all 34 other board dropdowns use)
//   encoding.parent → build the rings from the `Parent Emotion` field
//   encoding.level  → which ring a row belongs to (`Emotion Level`)
//
// So the wheel's structure is DATA the user can edit in the app, and a chart of
// something else is the same container with a different `meta.graph`.
//
// FEED AND HAND-DRAGGING COMPOSE — verified, not assumed (user: "i thought you
// could have feed items and other occurances"). `feedSync` only ever sweeps
// children carrying `meta.feedSourceId`, so an occurrence dragged onto the
// wheel by hand survives every sync. The wheel is fed AND droppable.
//
// THE OPERATION DECIDES WHAT A CLICK MEANS, stated by the user as the rule:
//   "we just need it to record the click and the info with it cause the
//    operation is handling what happens with it … the system shouldnt know its
//    a feelings wheel."
// So `Mood: Record Selection` does two things, and both are ordinary writes:
//   1. UNION the clicked emotion into today's `Mood` value. Mood is a
//      MULTISELECT — several feelings in a day is the normal case — so this
//      appends without duplicating, never replaces.
//   2. Write the same ids to `meta.graph.highlight`, which is how the picked
//      slice stays lit. The renderer draws whatever ids that list names and
//      decides nothing; keeping the highlight OP-WRITTEN is precisely what
//      stops the chart having to know what a feeling is.
//   The two hold the SAME ids, so one is written from the other rather than
//   maintained as two truths.
//
// DELETES NOTHING. Purely additive: one module, one occurrence, one operation.
export const id = "0046-emotions-wheel-graph";
export const describe =
  "Add an Emotions Wheel graph (sunburst, fed from the Emotions board) and the 'Mood: Record Selection' " +
  "operation that records a clicked emotion onto the day's Mood field and lights the slice. Deletes nothing.";

const TAG = "emotion";

function uuid() {
  return (globalThis.crypto?.randomUUID?.())
    || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * PURE — the operation's pipeline, so the shape is testable without a database.
 *
 * `$trigger` carries what ContainerGraph reports for a click:
 *   { occurrenceId, containerId, value, path, seriesName, name }
 *
 * The pipeline is deliberately flat and guard-first: a click on a slice with no
 * occurrence behind it (a hardcoded literal) carries a null occurrenceId, and
 * writing null into a multiselect would poison the field.
 */
export function buildRecordSelectionPipeline({ graphOccId, moodFieldId, dateFieldId }) {
  return {
    sources: [],
    steps: [
      // EVERY var is declared before use. A FIND that matches nothing does not
      // bind its itemVar at all, and referencing an unbound var THROWS
      // ("$moodHost not bound in current pipeline context") — so the guard that
      // is supposed to handle "no host found" never gets to run. Declaring up
      // front turns every miss into a value the guards can test.
      { id: uuid(), type: "action", actionType: "INIT_VAR",
        config: { name: "$picked", expr: "$trigger.occurrenceId" } },
      { id: uuid(), type: "action", actionType: "INIT_VAR", config: { name: "$graph", expr: "literal:" } },
      { id: uuid(), type: "action", actionType: "INIT_VAR", config: { name: "$day", expr: "literal:" } },
      { id: uuid(), type: "action", actionType: "INIT_VAR", config: { name: "$moodHost", expr: "literal:" } },
      { id: uuid(), type: "action", actionType: "INIT_VAR", config: { name: "$moods", expr: "json:[]" } },

      { id: uuid(), type: "if",
        // `condition` + `operator` — an IF step reads step.condition, and an
        // unrecognised key falls back to an EMPTY AND, which evaluates TRUE.
        // So a mis-keyed guard does not fail closed, it runs the branch
        // unconditionally; measured, both guards here were inert and the
        // pipeline threw on an unbound var instead of no-oping.
        condition: { operator: "AND", rules: [
          { left: "$picked", comparator: "IS_NOT_EMPTY", right: null },
        ]},
        then: [
          // ── The day this click belongs to ────────────────────────────────
          // Resolved from the graph's OWN effective filter, not from $today:
          // the wheel sits on a day column, and looking at yesterday and
          // clicking a feeling must record it on YESTERDAY. This is the same
          // resolution every tracker on this grid already does.
          { id: uuid(), type: "action", actionType: "FIND",
            config: {
              over: "$allOccurrences", itemVar: "$graph",
              predicate: { conjunction: "AND", rules: [
                { left: "id", comparator: "IS", right: graphOccId },
              ]},
            } },
          { id: uuid(), type: "action", actionType: "INIT_VAR",
            config: { name: "$day", expr: `$graph._effectiveFilter.${dateFieldId}` } },

          // ── The occurrence that CARRIES the mood for that day ────────────
          // Whatever binds Mood and sits on the same day. Found by BINDING
          // rather than by label, so renaming the journal cannot break it.
          { id: uuid(), type: "action", actionType: "FIND",
            config: {
              over: "$allOccurrences", itemVar: "$moodHost",
              predicate: { conjunction: "AND", rules: [
                { left: "_boundFieldIds", comparator: "ARRAY_INCLUDES", right: moodFieldId },
                { left: `fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$day" },
              ]},
            } },

          { id: uuid(), type: "if",
            condition: { operator: "AND", rules: [
              { left: "$moodHost", comparator: "IS_NOT_EMPTY", right: null },
            ]},
            then: [
              // UNION, not replace. Mood is a multiselect and a day holds
              // several feelings; re-picking one must not duplicate it.
              { id: uuid(), type: "action", actionType: "INIT_VAR",
                config: { name: "$moods", expr: `$moodHost.fields.${moodFieldId}.value` } },
              // `with`, not `expr` — MERGE_ARRAY's incoming key. A wrong key
              // reads as an empty merge and silently records nothing.
              { id: uuid(), type: "action", actionType: "MERGE_ARRAY",
                config: { name: "$moods", with: "$picked", unique: true } },
              { id: uuid(), type: "action", actionType: "UPDATE",
                config: { path: `$moodHost.fields.${moodFieldId}.value`, value: "$moods" } },

              // The highlight holds the SAME ids as the field — one truth,
              // written from the other. The graph renders this list and
              // decides nothing itself.
              { id: uuid(), type: "action", actionType: "UPDATE",
                config: { path: "$graph.meta.graph.highlight", value: "$moods" } },
            ],
            else: [] },
        ],
        else: [] },
    ],
  };
}

/** PURE — the graph occurrence's stored configuration. */
export function buildGraphSpec({ parentFieldId, levelFieldId }) {
  return {
    type: "sunburst",
    encoding: {
      // null category = the occurrence's own LABEL, which is the emotion word.
      category: null,
      // null value = tally rows; every emotion weighs the same, so the wheel
      // is evenly divided rather than sized by anything.
      value: null,
      // THE HIERARCHY COMES FROM FIELDS, not from nesting (0044's whole point).
      parent: parentFieldId,
      level: levelFieldId,
    },
    literals: [],
  };
}

/** PURE — the feed that fills the wheel from the Emotions board. */
export function buildEmotionsFeed({ boardCategoryFieldId, scopeOccId }) {
  return {
    enabled: true,
    roles: ["instance"],
    scope: scopeOccId,
    conditions: [
      { id: uuid(), fieldId: boardCategoryFieldId, comparator: "CONTAINS", value: TAG },
    ],
    sort: null,
    // NOT 0. `resolveFeedItems` reads `Number(feed.limit) > 0 ? … : 50`, so a
    // zero means the DEFAULT FIFTY, not "unlimited" — measured, the wheel came
    // back with 50 of its 128 emotions and silently drew a third of itself.
    // A whole board is the legitimate case for a graph feed, so the cap is set
    // above any plausible board rather than left to a default meant for a list.
    limit: 1000,
  };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation, Grid } = models;

  // ── Resolve everything by NAME, and report against a NAMED expectation ────
  // Counting alone is what let 0035 move a real page.
  const emotionsPageMod = await Module.findOne({ gridId, role: "page", label: "Emotions" }).lean();
  if (!emotionsPageMod) { log("no Emotions board — run 0044 first"); return; }
  const emotionsPageOcc = await Occurrence.findOne({ gridId, moduleId: emotionsPageMod.id }).lean();

  const levelField = await Field.findOne({ gridId, name: /^emotion level$/i }).lean();
  const parentField = await Field.findOne({ gridId, name: /^parent emotion$/i }).lean();
  const boardCategory = await Field.findOne({ gridId, name: /^board category$/i }).lean();
  const moodField = await Field.findOne({ gridId, name: /^mood$/i }).lean();
  const dateField = await Field.findOne({ gridId, name: /^date$/i }).lean();

  const missing = [
    !levelField && "Emotion Level", !parentField && "Parent Emotion",
    !boardCategory && "Board Category", !moodField && "Mood", !dateField && "Date",
  ].filter(Boolean);
  if (missing.length) { log(`missing field(s): ${missing.join(", ")} — refusing to guess`); return; }

  log(`Emotions board : page ${emotionsPageOcc?.id} (module ${emotionsPageMod.id})`);
  log(`fields         : level=${levelField.id} parent=${parentField.id} tag=${boardCategory.id}`);
  log(`Mood           : ${moodField.id} (type=${moodField.type}, multiSelect=${!!moodField.meta?.multiSelect})`);

  // Mood must already point at occurrences or the click's id has nothing to be
  // written into — that is what 0045 did, and this refuses rather than writing
  // occurrence ids into a field that stores strings.
  if (moodField.type !== "occurrence") {
    log(`Mood is type "${moodField.type}", not "occurrence" — run 0045 first`);
    return;
  }

  // Counted by ROLE, because the board CONTAINER carries the tag too (0044
  // stamps it so the board reads like the other 34). The feed pulls
  // roles:["instance"] only, so the container is not a row — reporting the raw
  // tag count would read as one emotion too many forever.
  const tagged = await Occurrence.find({ gridId, [`fields.${boardCategory.id}.value`]: TAG })
    .select("id moduleId").lean();
  const taggedMods = await Module.find({ gridId, id: { $in: tagged.map((o) => o.moduleId) } })
    .select("id role").lean();
  const roleById = new Map(taggedMods.map((m) => [m.id, m.role]));
  const instanceCount = tagged.filter((o) => roleById.get(o.moduleId) === "instance").length;
  log(`tagged "${TAG}": ${tagged.length} occurrence(s) — ${instanceCount} instance(s) the feed will pull, ` +
      `${tagged.length - instanceCount} non-instance (the board container itself)`);

  // ── Idempotency: a wheel already here means this ran ──────────────────────
  const existingGraph = await Module.findOne({ gridId, role: "container", kind: "graph", label: "Emotions Wheel" }).lean();
  const existingOp = await Operation.findOne({ gridId, name: "Mood: Record Selection" }).lean();
  log(`graph module  : ${existingGraph ? "exists" : "will create"}`);
  log(`operation     : ${existingOp ? "exists" : "will create"}`);

  // FIND-THEN-PATCH, not an early return: an earlier run of this file wrote
  // `limit: 0` on the feed, which resolveFeedItems reads as the DEFAULT FIFTY.
  // A grid that already has the wheel still needs that corrected, so the repair
  // lives here rather than in a hand-run script nobody will remember.
  if (existingGraph) {
    const occ = await Occurrence.findOne({ gridId, moduleId: existingGraph.id }).lean();
    const cur = Number(occ?.feed?.limit) || 0;
    if (occ && cur < instanceCount) {
      log(`existing feed limit ${cur} would truncate ${instanceCount} emotions — repairing to 1000`);
      if (!dryRun) await Occurrence.updateOne({ gridId, id: occ.id }, { $set: { "feed.limit": 1000 } });
    }
    if (existingOp) {
      // Same find-then-patch reason as the feed limit: an earlier run of this
      // file created the op with NO `triggerTypes`, which makes it fire only on
      // LOAD — the click did nothing. Repair rather than leave it inert.
      if (!Array.isArray(existingOp.triggerTypes) || !existingOp.triggerTypes.includes("onGraphSelect")) {
        log(`operation is missing triggerTypes (${JSON.stringify(existingOp.triggerTypes)}) — it would fire only on load; repairing`);
        if (!dryRun) {
          await Operation.updateOne({ gridId, id: existingOp.id }, { $set: { triggerTypes: ["onGraphSelect"] } });
        }
      }
      log("Emotions Wheel and its operation already exist — nothing further to do");
      return;
    }
  }

  // ── Where the wheel LIVES ────────────────────────────────────────────────
  // The day-page template, so every day column gets one and the wheel's
  // effective filter IS that day's date (which is how a click knows which day
  // it is recording). Resolved as the template whose MODULE still carries
  // meta.templateModule — apply_template STRIPS that from what it mints, so it
  // cannot resolve to a clone. That exact trap is recorded twice in CLAUDE.md.
  const dayTemplateMod = await Module.findOne({
    gridId, "meta.templateModule": true, label: /day page/i,
  }).lean();
  if (!dayTemplateMod) { log("no Day Page TEMPLATE module (meta.templateModule) — refusing to guess a home"); return; }
  const dayTemplateOcc = await Occurrence.findOne({ gridId, moduleId: dayTemplateMod.id }).lean();
  if (!dayTemplateOcc) { log(`Day Page template module ${dayTemplateMod.id} has no occurrence`); return; }
  log(`day template  : "${dayTemplateMod.label}" occ ${dayTemplateOcc.id} (${(dayTemplateOcc.occurrences || []).length} children)`);

  if (dryRun) { log("dry run — no writes"); return; }

  const grid = await Grid.findOne({ _id: gridId }).lean().catch(() => null);
  const userId = grid?.userId || emotionsPageOcc?.userId;

  const graphModId = existingGraph?.id || uuid();
  let graphOccId = null;

  if (!existingGraph) {
    await Module.create({
      id: graphModId, userId, gridId,
      role: "container", kind: "graph", label: "Emotions Wheel",
      meta: {
        // A heading level so it reads as a section of the day, like the others.
        headingLevel: 2,
        identitySignature: "daypage:Emotions Wheel",
      },
    });
    graphOccId = uuid();
    await Occurrence.create({
      id: graphOccId, userId, gridId, moduleId: graphModId,
      parentId: dayTemplateOcc.id,
      identitySignature: "daypage:Emotions Wheel",
      fields: {},
      occurrences: [],
      feed: buildEmotionsFeed({ boardCategoryFieldId: boardCategory.id, scopeOccId: emotionsPageOcc?.id || null }),
      meta: { graph: buildGraphSpec({ parentFieldId: parentField.id, levelFieldId: levelField.id }), createdBy: id },
    });
    // Listed as a child, not merely parented: a container renders its
    // occurrences[] — the 2026-08-01 (19) "listed but not embedded" failure
    // from the other direction.
    await Occurrence.updateOne({ gridId, id: dayTemplateOcc.id }, { $addToSet: { occurrences: graphOccId } });
    log(`minted Emotions Wheel graph ${graphOccId} under the Day Page template`);
  } else {
    const occ = await Occurrence.findOne({ gridId, moduleId: existingGraph.id }).lean();
    graphOccId = occ?.id || null;
    log(`re-using existing graph occurrence ${graphOccId}`);
  }

  if (!existingOp && graphOccId) {
    await Operation.create({
      id: uuid(), userId, gridId,
      name: "Mood: Record Selection",
      description: "A click on the Emotions Wheel records that emotion onto the day's Mood and lights the slice.",
      enabled: true, priority: 3,
      targetOccurrenceId: graphOccId,
      // BOTH are required, and the omission fails SILENTLY. `triggerObjects`
      // says WHICH graph; `triggerTypes` says the op fires on events at all —
      // with it absent, computeTriggerMatch takes the legacy no-config path and
      // the op only ever fires on LOAD (`transactionType == null`), so a click
      // matched nothing. Measured: the pipeline produced both writes when run
      // directly, and zero when fired through runMatchingOperations.
      triggerTypes: ["onGraphSelect"],
      // SCOPED TO THIS GRAPH, via the machinery that already exists.
      // `subjectType:"module"` + `subjectRole:"container"` makes
      // matchSubjectFilter compare `transaction.containerId` to targetId — and
      // ContainerGraph reports the graph occurrence as exactly that. A
      // `subjectType:"occurrence"` is NOT a case matchSubjectFilter knows, so
      // it falls through to "match anything" and this op would fire for every
      // graph on the grid.
      triggerObjects: [{
        eventType: "onGraphSelect",
        subjectType: "module",
        subjectRole: "container",
        targetId: graphOccId,
      }],
      pipeline: buildRecordSelectionPipeline({
        graphOccId, moodFieldId: moodField.id, dateFieldId: dateField.id,
      }),
    });
    log(`created "Mood: Record Selection" scoped to graph ${graphOccId}`);
  }

  log("done — the wheel draws from the Emotions board and a click records a mood");
}
