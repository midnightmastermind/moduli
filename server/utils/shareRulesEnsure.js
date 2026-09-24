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

export function catchAllPipeline(filesFolderId) {
  return { steps: [
    {
      id: randomUUID(), type: "if",
      condition: { operator: "AND", rules: [
        { left: "$share.props.occurrenceId", comparator: "IS_EMPTY", right: "" },
      ]},
      then: [
        { id: randomUUID(), type: "action", config: {
          type: "CREATE",
          parentFolderId: `literal:${filesFolderId}`,
          label: "$share.label",
          externalId: "$share.externalId",
          source: "share",
        }},
      ],
      else: [],
    },
  ]};
}

export async function ensureCatchAllRule({ userId, gridId }) {
  const existing = await Operation.findOne({
    userId, gridId,
    triggerObjects: { $elemMatch: { eventType: "onShare", shareType: "*" } },
  }).lean();
  if (existing) return { ruleId: existing.id, created: false };

  const files = await Folder.findOne({
    userId, gridId, name: FILES_FOLDER_NAME, "meta.protected": true,
  }).lean();
  if (!files) {
    throw new Error("this grid has no Files folder, so a share has nowhere to land");
  }

  const op = await Operation.create({
    id: randomUUID(), userId, gridId,
    name: CATCH_ALL_NAME,
    enabled: true, priority: CATCH_ALL_PRIORITY,
    triggerType: "onShare",
    triggerObjects: [{ eventType: "onShare", shareType: "*" }],
    pipeline: catchAllPipeline(files.id),
  });
  return { ruleId: op.id, created: true };
}
