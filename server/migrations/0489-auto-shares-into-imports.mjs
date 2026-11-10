// 0489 — Auto files link / text / image / pdf / anything-else shares into the Imports folder
// (spec 2026-11-09 smarter imports §E; plan Task 4).
//
// User: "Auto scatters things across share rules (Bookmarks, Lookup, YouTube, Files); the user wants them in
// one place". Each of those rules is rewritten in place:
//   - every FIXED destination of a CREATE / MOVE_OCCURRENCE (a literal parent, container or folder) becomes
//     the Imports folder. A destination named by an expression ($share.clip.parentId — the extension's own
//     pick) is the sender's choice and is left as it is.
//   - link: after each bookmark CREATE, an IMPORT_TO_PAGE that builds the readable page beside it (queued).
//   - text: the CREATE becomes IMPORT_TO_PAGE, with the old CREATE kept as the fallback for text too short
//     to make a page.
//   - image: an IMPORT_TO_PAGE first (OCR -> a page embedding the picture; no text -> the picture alone
//     moved into Imports).
// Calendar, contact and profile rules are never touched (retargetShareRule returns null for them).
// Already-shared items stay where they are: only the rules change. Idempotent: `meta.imports0489`.
import { randomUUID } from "node:crypto";
import { shareTriggerOf } from "../services/shareRules.js";
import { findImportsFolder } from "../utils/importsFolder.js";
import { CATCH_ALL_VERSION } from "../utils/shareRulesEnsure.js";

export const id = "0489-auto-shares-into-imports";
export const describe = "Auto link / text / image / pdf / catch-all share rules file into the Imports folder; a link also gets its readable page.";
export const description = describe;
export const touches = ["operations"];

export const RETARGET_TYPES = new Set(["link", "text", "image", "pdf", "*"]);
export const MARKER = "imports0489";

const isFixedDest = (v) => typeof v === "string" && v !== "" && !v.startsWith("$");
const actionStep = (config) => ({ id: randomUUID(), type: "action", config });
const importStep = (lit, extra = {}) => actionStep({ type: "IMPORT_TO_PAGE", from: "$share", parentFolderId: lit, ...extra });
const isBookmarkCreate = (cfg) => [cfg.kind, cfg.moduleKind].some((k) => k === "bookmark" || k === "$share.clip.moduleKind");
const hasImportStep = (node) => JSON.stringify(node || {}).includes('"IMPORT_TO_PAGE"');

/** Pure: the rule rewritten for Imports, or null when it is not one of these rules or is already done. */
export function retargetShareRule(op, importsId) {
  if (!importsId) throw new Error("retargetShareRule: no Imports folder");
  const trig = shareTriggerOf(op);
  if (!trig || !RETARGET_TYPES.has(trig.shareType)) return null;
  if (op.meta?.[MARKER] || hasImportStep(op.pipeline)) return null;
  const type = trig.shareType;
  const lit = `literal:${importsId}`;
  let changed = false;
  let bookmarkN = 0;

  const rewriteAction = (st) => {
    const cfg = st?.config || {};
    if (cfg.type === "CREATE") {
      const dest = cfg.parentFolderId ?? cfg.parentId ?? cfg.parent;
      if (!isFixedDest(dest)) return [st];                       // the sender's own pick
      const next = { ...cfg, parentFolderId: lit };
      delete next.parent; delete next.parentId;
      changed = true;
      if (type === "link" && isBookmarkCreate(cfg)) {
        bookmarkN += 1;
        next.itemIdVar = next.itemIdVar || `$bookmarkId${bookmarkN > 1 ? bookmarkN : ""}`;
        next.resultVar = next.resultVar || `$bookmarkRes${bookmarkN > 1 ? bookmarkN : ""}`;
        return [{ ...st, config: next }, importStep(lit, { linkTo: next.itemIdVar, linkResult: next.resultVar })];
      }
      if (type === "text") {
        return [
          importStep(lit, { into: "$pageId" }),
          { id: randomUUID(), type: "if",
            condition: { operator: "AND", rules: [{ id: randomUUID(), left: "$pageId", comparator: "IS_EMPTY", right: "" }] },
            then: [{ ...st, config: next }], else: [] },
        ];
      }
      return [{ ...st, config: next }];
    }
    if (cfg.type === "MOVE_OCCURRENCE") {
      const key = cfg.toContainerId != null ? "toContainerId" : "toContainerIdExpr";
      if (!isFixedDest(cfg[key])) return [st];
      changed = true;
      return [{ ...st, config: { ...cfg, toContainerId: lit, toContainerIdExpr: undefined } }];
    }
    return [st];
  };

  const walk = (steps) => {
    const out = [];
    for (const st of steps || []) {
      if (st?.type === "if") out.push({ ...st, then: walk(st.then), else: walk(st.else) });
      else if (st?.type === "loop") out.push({ ...st, body: walk(st.body) });
      else out.push(...rewriteAction(st));
    }
    return out;
  };

  let steps = walk(op.pipeline?.steps);
  if (type === "image") { steps = [importStep(lit), ...steps]; changed = true; }
  if (!changed) return null;
  const meta = { ...(op.meta || {}), [MARKER]: true };
  if (type === "*") meta.catchAllVersion = CATCH_ALL_VERSION;
  return { ...op, pipeline: { ...(op.pipeline || {}), steps }, meta };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Folder } = models;
  const importsId = await findImportsFolder({ gridId, FolderModel: Folder });
  if (!importsId) throw new Error("this grid has no Imports folder — nothing to retarget to");
  const ops = await Operation.find({ gridId, "triggerObjects.eventType": "onShare" }).lean();
  const now = new Date();
  let n = 0;
  for (const op of ops) {
    const next = retargetShareRule(op, importsId);
    const t = shareTriggerOf(op)?.shareType;
    if (!next) { log(`  ${op.name} [${t}] — unchanged`); continue; }
    n += 1;
    const imports = (JSON.stringify(next.pipeline).match(/"IMPORT_TO_PAGE"/g) || []).length;
    log(`  ${op.name} [${t}] — destinations -> Imports, ${imports} import step(s)`);
    if (!dryRun) await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline: next.pipeline, meta: next.meta, updatedAt: now } });
  }
  log(`  ${n} rule(s), Imports ${importsId}${dryRun ? " (dry run)" : ". RESTART pm2."}`);
}
