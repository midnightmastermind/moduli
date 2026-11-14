// services/importJobs.js
//
// THE READABLE PAGE IS BUILT AFTER THE SHARE ANSWERS (spec 2026-11-09 §E, plan Task 4).
// A shared link is saved as a bookmark at once; reading the page (a fetch that can take 20s, or fail)
// and an image's OCR (seconds on the droplet's CPU) run here, one job at a time, so the share request
// never waits on them and a burst of shares never runs ten fetches at once.
//
// A JOB:
//   link   runImport(link) under Imports -> the page root gets meta.bookmarkId, the bookmark gets
//          meta.readerPageId. A fetch that fails sets meta.readerPageError on the bookmark: the bookmark
//          stays, nothing throws.
//   image  OCR -> a page under Imports that embeds the picture's own occurrence (the file stays in
//          Files). No words read -> no page; the PICTURE is moved into Imports instead, so a photo
//          with no text still lands where every share lands.
//
// WRITES are the import writer (runImport -> markdownToModuli) plus one-key `meta` $sets, each mirrored
// into the warm cache and broadcast (ruling R3: there is no socket from the server to itself). In-process:
// a restart drops queued jobs; the bookmark keeps no readerPageId and a re-share builds the page.
import path from "node:path";
import { fileURLToPath } from "node:url";
import Occurrence from "../models/Occurrence.js";
import Module from "../models/Module.js";
import { runImport } from "./importPipeline.js";
import { decompressTextmap } from "../utils/textmapCompression.js";

const UPLOADS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "uploads");

const queue = [];
const inFlight = new Set();      // job keys queued or running — the same share twice queues once
const listeners = new Set();
let draining = false;
let idleWaiters = [];

const jobKey = (job) => `${job.gridId}::${job.externalId || job.linkTo || job.imageOccurrenceId || ""}`;

/** Called with `(job, result)` after every job. Returns an unsubscribe. */
export function onImportDone(cb) { listeners.add(cb); return () => listeners.delete(cb); }

/** Queue a job; a job whose key is already queued or running is dropped. @returns {boolean} queued */
export function queueImport(job) {
  const key = jobKey(job);
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  queue.push({ ...job, _key: key });
  if (!draining) drain();
  return true;
}

// THE CLEAN-UP LINE (Task 7): Ollama after every import, one at a time, on its own chain so a 60s model call
// never holds up the next share's page. Off unless IMPORT_AI_CLEANUP=1 — it ships on only when measured to help.
let enrichChain = Promise.resolve();
export const aiCleanupOn = () => process.env.IMPORT_AI_CLEANUP === "1";
/** Queue Ollama clean-up of a written import. @returns {boolean} queued */
export function queueEnrich({ rootOccurrenceId, gridId, userId, io = null, mirror = null }, deps = {}) {
  if (!rootOccurrenceId || !aiCleanupOn()) return false;
  enrichChain = enrichChain.then(async () => {
    try {
      const { enrichImport } = await import("./importEnrich.js");
      const { examplesFor } = await import("./importCorrections.js").catch(() => ({}));
      const r = await enrichImport({ rootOccurrenceId, gridId, userId, io, mirror }, { examplesFor, ...deps });
      if (!r.applied) console.log(`[importJobs] clean-up left ${rootOccurrenceId} as written: ${r.reason || "no change"}`);
    } catch (err) { console.warn("[importJobs] clean-up failed:", err?.message || err); }
  });
  return true;
}
export function whenEnrichIdle() { return enrichChain; }

/** Resolves when the queue is empty (tests). */
export function whenImportsIdle() {
  if (!draining && !queue.length) return Promise.resolve();
  return new Promise((r) => idleWaiters.push(r));
}

async function drain() {
  draining = true;
  while (queue.length) {
    const job = queue.shift();
    let result;
    try { result = await runImportJob(job); }
    catch (err) {
      console.warn(`[importJobs] ${job.source?.kind} job failed:`, err?.message || err);
      result = { ok: false, error: String(err?.message || err) };
    } finally { inFlight.delete(job._key); }
    for (const cb of listeners) { try { cb(job, result); } catch { /* a listener never stops the queue */ } }
  }
  draining = false;
  const w = idleWaiters; idleWaiters = [];
  for (const r of w) r();
}

function cacheable(doc) {
  if (!doc) return doc;
  return doc.textmap ? { ...doc, textmap: decompressTextmap(doc.textmap) } : doc;
}

/** `$set` one or more `meta.<key>` on an occurrence, then mirror + broadcast it. */
async function setOccMeta({ id, userId, set, io, mirror }) {
  const $set = {};
  for (const [k, v] of Object.entries(set)) $set[`meta.${k}`] = v;
  const doc = await Occurrence.findOneAndUpdate({ id, userId }, { $set }, { returnDocument: "after", lean: true });
  if (!doc) return null;
  const out = cacheable(doc);
  mirror?.("occurrence", out);
  io?.to?.(`user:${userId}`)?.emit?.("occurrence_updated", { occurrence: out });
  return out;
}

/** Move an occurrence into a folder (a folder holds rows by parentId alone). */
async function moveIntoFolder({ id, folderId, userId, io, mirror }) {
  const occ = await Occurrence.findOne({ id, userId }).lean();
  if (!occ || occ.parentId === folderId) return;
  if (occ.parentId) {
    const r = await Occurrence.findOneAndUpdate({ id: occ.parentId, userId, occurrences: id },
      { $pull: { occurrences: id } }, { returnDocument: "after", lean: true });
    if (r) { mirror?.("occurrence", cacheable(r)); io?.to?.(`user:${userId}`)?.emit?.("occurrence_updated", { occurrence: cacheable(r) }); }
  }
  const moved = await Occurrence.findOneAndUpdate({ id, userId }, { $set: { parentId: folderId } }, { returnDocument: "after", lean: true });
  if (moved) { mirror?.("occurrence", cacheable(moved)); io?.to?.(`user:${userId}`)?.emit?.("occurrence_updated", { occurrence: cacheable(moved) }); }
}

/** An uploaded picture's file on disk (or its remote address), from its module's fileRef. */
export async function imageSourceOf(occurrenceId, userId) {
  const occ = await Occurrence.findOne({ id: occurrenceId, userId }).lean();
  const mod = occ?.moduleId ? await Module.findOne({ id: occ.moduleId, userId }).lean() : null;
  const ref = mod?.fileRef || null;
  if (!ref) return { filePath: null, url: null };
  if (/^https?:\/\//i.test(ref)) return { filePath: ref, url: ref };
  if (/^[a-z]+:/i.test(ref)) return { filePath: null, url: null };     // gdrive:… — no bytes on this box
  const rel = ref.replace(/^\/?uploads\//, "").replace(/^\/+/, "");
  return { filePath: path.join(UPLOADS_DIR, rel), url: `/uploads/${rel}` };
}

/** A fetch failure in words: a 401/403/429 means the site refuses requests from the server, not that the page is gone. */
export function readableImportError(reason) {
  const m = /fetch failed \((\d{3})\)/.exec(reason || "");
  if (!m) return reason;
  const code = Number(m[1]);
  if (code === 401 || code === 403) return `the site refused the server (${code}); open it in Web mode instead`;
  if (code === 429) return `the site is limiting requests (${code}); try again later`;
  if (code === 404 || code === 410) return `the page is gone (${code})`;
  if (code >= 500) return `the site had an error (${code})`;
  return reason;
}

/**
 * Run one job to completion. Exported for tests (inject `deps.fetchPageHtml` / `deps.ocrImage`).
 * @returns {Promise<{ ok, rootOccurrenceId?, empty?, skipped?, error? }>}
 */
export async function runImportJob(job) {
  const { source, gridId, userId, parentFolderId = null, parentId = null, linkTo = null, externalId = null, overrides = null, io = null, mirror = null } = job;
  const deps = { ...(job.deps || {}), mirror, broadcast: (evt, p) => io?.to?.(`user:${userId}`)?.emit?.(evt, p) };

  if (linkTo) {
    const bm = await Occurrence.findOne({ id: linkTo, userId }).lean();
    if (!bm) return { ok: false, error: "the bookmark is gone" };
    if (bm.meta?.readerPageId) return { ok: true, skipped: "already has a page", rootOccurrenceId: bm.meta.readerPageId };
  }

  let src = source;
  if (source.kind === "image" && !source.ocrPage && !source.filePath) {
    const where = await imageSourceOf(source.imageOccurrenceId, userId);
    src = { ...source, ...where };
  }

  let out;
  try {
    if (src.kind === "image" && !src.filePath && !src.ocrPage) throw new Error("the picture's file is not on this server");
    out = await runImport({ source: src, gridId, userId, parentFolderId, parentId, externalId, overrides }, deps);
  } catch (err) {
    const reason = readableImportError(String(err?.message || err));
    console.warn(`[importJobs] ${src.kind} import did not build a page: ${reason}`);
    if (linkTo) await setOccMeta({ id: linkTo, userId, set: { readerPageError: reason }, io, mirror });
    if (src.kind === "image" && src.imageOccurrenceId) await moveIntoFolder({ id: src.imageOccurrenceId, folderId: parentFolderId, userId, io, mirror });
    return { ok: false, error: reason };
  }

  if (out.empty) {
    if (src.kind === "image" && src.imageOccurrenceId) {
      await moveIntoFolder({ id: src.imageOccurrenceId, folderId: parentFolderId, userId, io, mirror });
    }
    if (linkTo) await setOccMeta({ id: linkTo, userId, set: { readerPageError: "the page has no readable text" }, io, mirror });
    return { ok: true, empty: true };
  }

  const rootId = out.rootOccurrenceId;
  queueEnrich({ rootOccurrenceId: rootId, gridId, userId, io, mirror });
  if (linkTo) {
    await setOccMeta({ id: rootId, userId, set: { bookmarkId: linkTo }, io, mirror });
    await setOccMeta({ id: linkTo, userId, set: { readerPageId: rootId, readerPageError: null }, io, mirror });
  }
  return { ok: true, rootOccurrenceId: rootId };
}
