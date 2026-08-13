// server/migrations/0093-moods-tracker-shows-names.mjs
//
// User, 2026-08-12: "it still shows ids for moods."
//
// 0088 FIXED THE FIELD AND NOT THE TRACKER, and this is the difference. The Mood
// field now resolves names wherever the FIELD renders (labelPath/valuePath were
// missing entirely) — but the tracker does not render the field. It PUSHES the
// raw value into a display field of its own:
//
//   PUSH_TO_ARRAY $rows { mood: "$inst.fields.<Mood>.value", timeslot, date }
//   SET_VAR       $lastMoodSingle = "$inst.fields.<Mood>.value"
//
// and that value is an ARRAY OF OCCURRENCE IDS. Whatever the field's option list
// says, a stored id printed into a text cell is an id. Measured through the real
// executor: `Moods=[{"mood":["a6157ec1-…"],"date":"2026-08-12"}]`.
//
// So the tracker resolves them itself, the way the media trackers already do
// (Movies/Books push `$watchInst.label`, never the pick's id).
//
// THE NAME IS ON THE MODULE, NOT THE OCCURRENCE. An emotion carries
// `occ.label: null` and `module.label: "Happy"` — measured — so reading `.label`
// alone yields nothing. `$allItems` entries carry BOTH `label` (which prefers an
// occurrence override) and `moduleLabel` (the stable template name), so the
// fallback chain is label -> moduleLabel. Reading only one of them is how this
// would come back looking fixed and print blanks instead of ids.
//
// A MOOD VALUE IS A LIST — the field is multiSelect — so the names are joined
// into one string per row rather than pushing an array the cell would print as
// `[object Object]`-adjacent noise.
export const id = "0093-moods-tracker-shows-names";
export const describe =
  "The Moods tracker stores the emotion NAMES it resolves, instead of raw occurrence ids.";

/**
 * PURE — rewrite the row-building branch so it pushes names.
 * Exported so a test drives exactly what ships.
 *
 * THROWS when the push it means to rewrite is missing.
 */
export function buildNamedRowsPipeline(pipeline, { moodFieldId }) {
  if (!moodFieldId) throw new Error("0093: missing moodFieldId");
  const valueExpr = `$inst.fields.${moodFieldId}.value`;
  let rewritten = 0;

  // Built fresh per matched branch so two branches could never share a step id.
  const nameSteps = () => ([
    { type: "action", action: "INIT_VAR", cfg: { name: "$moodNames", value: "" } },
    {
      type: "loop", overExpr: valueExpr, as: "$moodId",
      body: [
        { type: "action", action: "INIT_VAR",
          cfg: { name: "$moodOcc", expr: "$allItemsById.${$moodId}" } },
        // label first (an occurrence override wins), moduleLabel second — an
        // emotion carries no occurrence label, so without the fallback this
        // prints blanks instead of ids, which is not an improvement.
        { type: "action", action: "INIT_VAR", cfg: { name: "$moodName", expr: "$moodOcc.label" } },
        { type: "if",
          condition: { conjunction: "AND",
            rules: [{ left: "$moodName", comparator: "IS_EMPTY", right: "" }] },
          then: [{ type: "action", action: "SET_VAR",
            cfg: { name: "$moodName", expr: "$moodOcc.moduleLabel" } }],
          else: [] },
        // Join with ", " — the first name must not be prefixed by a separator.
        { type: "if",
          condition: { conjunction: "AND",
            rules: [{ left: "$moodNames", comparator: "IS_EMPTY", right: "" }] },
          then: [{ type: "action", action: "SET_VAR",
            cfg: { name: "$moodNames", expr: "$moodName" } }],
          else: [{ type: "action", action: "SET_VAR",
            cfg: { name: "$moodNames", expr: "${$moodNames}, ${$moodName}" } }] },
      ],
    },
  ]);

  const walk = (steps) => (steps || []).map((step) => {
    if (step?.type === "if") {
      const then = step.then || [];
      const push = then.find(
        (s) => s.action === "PUSH_TO_ARRAY" && s.cfg?.value && s.cfg.value.mood === valueExpr);
      if (push) {
        rewritten++;
        const rest = then.map((s) => {
          if (s === push) {
            return { ...s, cfg: { ...s.cfg, value: { ...s.cfg.value, mood: "$moodNames" } } };
          }
          if (s.action === "SET_VAR" && s.cfg?.expr === valueExpr) {
            return { ...s, cfg: { ...s.cfg, expr: "$moodNames" } };
          }
          return s;
        });
        // The names are resolved BEFORE the push that consumes them.
        return { ...step, then: [...nameSteps(), ...rest], else: walk(step.else) };
      }
      return { ...step, then: walk(then), else: walk(step.else) };
    }
    if (step?.type === "loop") return { ...step, body: walk(step.body) };
    return step;
  });

  const steps = walk(pipeline?.steps || []);
  if (rewritten !== 1) {
    throw new Error(`0093: expected exactly 1 row push to rewrite, found ${rewritten}`);
  }
  return { ...pipeline, steps };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Field } = models;
  const fields = await Field.find({ gridId }).lean();
  const moodField = fields.find((f) => f.name === "Mood");
  const op = await Operation.findOne({ gridId, name: "Moods" }).lean();
  if (!moodField || !op) {
    log(`REFUSING: Mood=${!!moodField} op=${!!op} — nothing written.`);
    return;
  }

  const already = JSON.stringify(op.pipeline?.steps || []).includes("$moodNames");
  if (already) { log(`the tracker already stores names — no change.`); if (dryRun) return; }

  log(`Moods tracker: rows will store the resolved emotion NAME instead of ` +
    `$inst.fields.${moodField.id.slice(0, 8)}.value (an array of ids)`);
  log(`  name resolution: $moodOcc.label, falling back to $moodOcc.moduleLabel ` +
    `(an emotion carries no occurrence label)`);

  if (dryRun) {
    log(`WOULD resolve each mood id to its name and push a comma-joined string.`);
    return;
  }
  if (!already) {
    const pipeline = buildNamedRowsPipeline(op.pipeline, { moodFieldId: moodField.id });
    await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  }
  log(`the Moods tracker now stores names.`);
}
