// server/utils/shareRulesEnsure.js
//
// D18 — a grid gets exactly ONE share rule automatically: the `*` catch-all,
// pointing at its protected Files folder. Find-or-mint and idempotent, the
// same posture as `protectedFoldersEnsure.js`.
//
// Typed rules are NOT minted here (D19). They name containers that exist only
// on a particular grid, so bootstrap could not invent them.
//
// WHAT THE CATCH-ALL DOES. Ingress has already uploaded a shared FILE into
// Files (spec §3) — that upload IS the row, so the rule must not mint a second
// one beside it. For a link or text there is no row yet, so it mints one in
// Files labelled `$share.label` (ingress computes it: title → url → first line).
//
// NO FILES FOLDER IS AN ERROR, NOT A FALLBACK. Minting the rule with no parent
// would put every unmatched share in a row nothing renders — exactly the
// "a share silently vanishes" failure spec §12 forbids.
import Operation from "../models/Operation.js";
import Folder from "../models/Folder.js";
import { FILES_FOLDER_NAME } from "./protectedFolders.js";
import { randomUUID } from "node:crypto";

export const CATCH_ALL_PRIORITY = 99;
export const CATCH_ALL_NAME = "Share: anything else";
// Bumped whenever the pipeline below changes. An existing catch-all nobody has
// edited (`meta.userEdited` unset) is brought up to date; an edited one is the
// user's and is never overwritten.
export const CATCH_ALL_VERSION = 2;

const ifStep = (rules, then, otherwise = []) => ({
  id: randomUUID(), type: "if",
  condition: { operator: "AND", rules },
  then, else: otherwise,
});
const create = (config) => ({ id: randomUUID(), type: "action", config: { type: "CREATE", ...config } });

// D15 — AN EXTENSION CLIP LANDS EXACTLY AS IT DID THROUGH /ingest. Same label,
// same bookmark/image module shape keyed by the URL, same URL/Excerpt/Cover
// field writes, and `source: "clip"` with the extension's `<shape>:<url>`
// externalId — /ingest's identity is (source, externalId), so a page clipped
// before the re-route is UPDATED, not duplicated. The spec asked for a shipped
// `link` rule; D18 forbids bootstrapping typed rules, so the compatibility
// lives here, and a link rule the user writes (and halts) takes precedence.
//
// The one deliberate difference: a clip with no destination configured used
// to land parented to nothing, where nothing renders it. It lands in Files.
const clipCreate = (parent) => create({
  ...parent,
  label: "$share.clip.label",
  externalId: "$share.externalId",
  source: "literal:clip",
  moduleRole: "$share.clip.moduleRole",
  moduleKind: "$share.clip.moduleKind",
  moduleFileRef: "$share.clip.moduleFileRef",
  fieldsFrom: "$share.clip.fields",
  meta: "$share.clip.meta",
});

export function catchAllPipeline(filesFolderId) {
  const inFiles = { parentFolderId: `literal:${filesFolderId}` };
  return { steps: [
    ifStep(
      [{ left: "$share.clip", comparator: "IS_NOT_EMPTY", right: "" }],
      [ifStep(
        [{ left: "$share.clip.parentId", comparator: "IS_NOT_EMPTY", right: "" }],
        [clipCreate({ parentId: "$share.clip.parentId" })],
        [clipCreate(inFiles)],
      )],
      // Anything else: a file ingress already uploaded IS its row, so only a
      // link or text with no row yet is minted.
      [ifStep(
        [{ left: "$share.props.occurrenceId", comparator: "IS_EMPTY", right: "" }],
        [create({ ...inFiles, label: "$share.label", externalId: "$share.externalId", source: "share" })],
      )],
    ),
  ]};
}

export async function ensureCatchAllRule({ userId, gridId }) {
  const existing = await Operation.findOne({
    userId, gridId,
    triggerObjects: { $elemMatch: { eventType: "onShare", shareType: "*" } },
  }).lean();
  const stale = existing
    && (existing.meta?.catchAllVersion ?? 1) < CATCH_ALL_VERSION
    && !existing.meta?.userEdited;
  if (existing && !stale) return { ruleId: existing.id, created: false };

  const files = await Folder.findOne({
    userId, gridId, name: FILES_FOLDER_NAME, "meta.protected": true,
  }).lean();
  if (!files) {
    throw new Error("this grid has no Files folder, so a share has nowhere to land");
  }

  if (stale) {
    await Operation.updateOne({ id: existing.id, userId }, { $set: {
      pipeline: catchAllPipeline(files.id),
      "meta.catchAllVersion": CATCH_ALL_VERSION,
    }});
    return { ruleId: existing.id, created: false, upgraded: true };
  }

  const op = await Operation.create({
    id: randomUUID(), userId, gridId,
    name: CATCH_ALL_NAME,
    enabled: true, priority: CATCH_ALL_PRIORITY,
    triggerType: "onShare",
    triggerObjects: [{ eventType: "onShare", shareType: "*" }],
    pipeline: catchAllPipeline(files.id),
    meta: { catchAllVersion: CATCH_ALL_VERSION },
  });
  return { ruleId: op.id, created: true };
}
