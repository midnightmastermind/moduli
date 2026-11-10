// services/importEnrich.js
//
// OLLAMA CLEANS UP AN IMPORT AFTER IT IS SAVED, AND MAY ONLY FIX MISREADS (smarter imports Task 7).
// The rules result is written first (importPipeline); this runs later, in the background, and never
// blocks a save. A local model asked to "fix OCR" will happily reword a sentence, drop one, or translate
// a paragraph — so its answer is applied only when `acceptCleanup` says every change is a small one:
//   - every changed span is <= 3 characters (a misread letter, a rejoined word)
//   - the edited characters total <= 3% of the text (at least 3)
//   - the word count moves by <= 2% (at least 1)
//   - the paragraph count moves by <= 1 per 10 paragraphs (at least 1)
// Whitespace differences are not changes. Anything else leaves the rules result as it was.
//
// Only plain textblocks are cleaned (paragraphs of unmarked text): a block holding a link chip, bold, a
// heading or an embed is left alone, because rebuilding it from plain text would lose what it holds.
// Switched on by IMPORT_AI_CLEANUP=1 (services/importJobs.queueEnrich), off unless measured to help.
import Occurrence from "../models/Occurrence.js";
import Module from "../models/Module.js";
import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";
import { ollamaHeaders } from "../utils/ollamaHeaders.js";

export const CLEANUP_TIMEOUT_MS = 60000;
const MAX_NODES = 600;

const SYSTEM_PROMPT = `You fix text that was read by OCR or copied from a web page.
Fix misread characters (a "|" that is "I", "rn" read as "m", a "0" that is "O") and rejoin words or paragraphs that were broken across lines.
Keep every word you cannot verify exactly as written. Do not reword, summarise, translate, add or remove sentences.
Keep every line of the form [[[n]]] exactly as it is, in the same order.
Return only the corrected text, nothing else.`;

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
const tokens = (s) => norm(s).split(" ").filter(Boolean);
const paragraphs = (s) => String(s || "").split(/\n\s*\n/).filter((p) => p.trim());

/** Myers diff of two strings, giving up past `maxD` edits. @returns ops [{eq|del|ins}] or null. */
function diffOps(a, b, maxD) {
  const n = a.length, m = b.length;
  const max = Math.min(n + m, maxD);
  const off = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) return backtrack(trace, v, d, n, m, off);
    }
  }
  return null;
}
function backtrack(trace, vLast, dEnd, n, m, off) {
  const ops = [];
  let x = n, y = m;
  for (let d = dEnd; d > 0; d--) {
    const v = trace[d];
    const k = x - y;
    const prevK = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? k + 1 : k - 1;
    const prevX = v[off + prevK], prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push("eq"); x--; y--; }
    ops.push(x === prevX ? "ins" : "del");
    x = prevX; y = prevY;
  }
  while (x > 0 && y > 0) { ops.push("eq"); x--; y--; }
  return ops.reverse();
}

/** Is `after` only small corrections of `before`? @returns {{ ok: boolean, reason?: string }} */
export function acceptCleanup(before, after) {
  const a = norm(before), b = norm(after);
  if (!b) return { ok: false, reason: "empty answer" };
  if (a === b) return { ok: true };
  const budget = Math.max(3, Math.ceil(a.length * 0.03));
  const ops = diffOps(a, b, budget * 2);
  if (!ops) return { ok: false, reason: "too many changes" };
  let total = 0, del = 0, ins = 0;
  const close = () => {
    const span = Math.max(del, ins);
    total += span; del = 0; ins = 0;
    return span;
  };
  for (const op of [...ops, "eq"]) {
    if (op === "del") del++;
    else if (op === "ins") ins++;
    else if (del || ins) { if (close() > 3) return { ok: false, reason: "a change longer than 3 characters" }; }
  }
  if (total > budget) return { ok: false, reason: "too many changes" };
  const wa = tokens(before).length, wb = tokens(after).length;
  if (Math.abs(wa - wb) > Math.max(1, Math.floor(wa * 0.02))) return { ok: false, reason: "word count changed" };
  const pa = paragraphs(before).length, pb = paragraphs(after).length;
  if (Math.abs(pa - pb) > Math.max(1, Math.floor(pa / 10))) return { ok: false, reason: "paragraph count changed" };
  return { ok: true };
}

/** The model's answer, or null on timeout / error / no answer. */
export async function cleanupWithOllama({ markdown, kind = null, examples = [] }, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  const url = process.env.OLLAMA_URL || "http://localhost:11434";
  const model = process.env.IMPORT_OLLAMA_MODEL || process.env.OLLAMA_MODEL || "llama3.2:3b";
  const messages = [{ role: "system", content: SYSTEM_PROMPT + (kind ? `\nThe text came from: ${kind}.` : "") }];
  for (const ex of examples || []) {
    if (!ex?.before || !ex?.after) continue;
    messages.push({ role: "user", content: ex.before }, { role: "assistant", content: ex.after });
  }
  messages.push({ role: "user", content: markdown });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs || CLEANUP_TIMEOUT_MS);
  try {
    const res = await fetchFn(`${url}/api/chat`, {
      method: "POST", signal: ctrl.signal,
      headers: ollamaHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ model, messages, stream: false, options: { temperature: 0 } }),
    });
    if (!res?.ok) return null;
    const body = await res.json();
    const text = String(body?.message?.content || "").replace(/^```[a-z]*\n?|\n?```\s*$/g, "").trim();
    return text || null;
  } catch {
    return null;
  } finally { clearTimeout(timer); }
}

/** A textblock's text when it is only paragraphs of unmarked text, else null. Pure. */
export function simpleBlockText(textmap) {
  const doc = textmap?.type === "doc" ? textmap : null;
  if (!doc || !Array.isArray(doc.content) || !doc.content.length) return null;
  const paras = [];
  for (const node of doc.content) {
    if (node.type !== "paragraph") return null;
    let t = "";
    for (const c of node.content || []) {
      if (c.type !== "text" || (c.marks && c.marks.length)) return null;
      t += c.text;
    }
    paras.push(t);
  }
  const text = paras.join("\n\n");
  return text.trim() ? text : null;
}

const textToTextmap = (text) => ({ type: "doc", content: paragraphs(text).map((p) => ({ type: "paragraph", content: [{ type: "text", text: p.trim() }] })) });

/** The import's textblocks, in reading order: every occurrence its root lists, level by level. */
async function importTextblocks(root, userId) {
  const seen = new Set([root.id]);
  let frontier = [...(root.occurrences || [])];
  const ordered = [];
  while (frontier.length && seen.size < MAX_NODES) {
    const ids = frontier.filter((id) => id && !seen.has(id));
    ids.forEach((id) => seen.add(id));
    if (!ids.length) break;
    const occs = await Occurrence.find({ userId, id: { $in: ids } }).lean();
    const byId = new Map(occs.map((o) => [o.id, o]));
    const next = [];
    for (const id of ids) { const o = byId.get(id); if (!o) continue; ordered.push(o); next.push(...(o.occurrences || [])); }
    frontier = next;
  }
  const mods = await Module.find({ userId, id: { $in: [...new Set(ordered.map((o) => o.moduleId).filter(Boolean))] } }, { id: 1, role: 1 }).lean();
  const role = new Map(mods.map((m) => [m.id, m.role]));
  return ordered.filter((o) => role.get(o.moduleId) === "textblock");
}

const MARK = (i) => `[[[${i}]]]`;

/**
 * Clean one import up. @returns {{ applied: boolean, changed?: number, reason?: string }}
 * @param deps { fetch, examplesFor, timeoutMs } — injectable for tests.
 */
export async function enrichImport({ rootOccurrenceId, gridId, userId, io = null, mirror = null }, deps = {}) {
  const root = await Occurrence.findOne({ id: rootOccurrenceId, userId }).lean();
  if (!root) return { applied: false, reason: "gone" };
  const blocks = [];
  for (const o of await importTextblocks(root, userId)) {
    const text = simpleBlockText(decompressTextmap(o.textmap));
    if (text) blocks.push({ occ: o, text });
  }
  if (!blocks.length) return { applied: false, reason: "nothing to clean" };
  const kind = root.meta?.importSource?.kind || null;
  const site = (() => { try { return new URL(root.meta?.importSource?.url).hostname; } catch { return null; } })();
  const examples = deps.examplesFor ? await deps.examplesFor({ userId, gridId, kind, site }).catch(() => []) : [];
  const joined = blocks.map((b, i) => `${MARK(i)}\n${b.text}`).join("\n\n");
  const answer = await cleanupWithOllama({ markdown: joined, kind, examples }, deps);
  if (!answer) return { applied: false, reason: "ollama" };

  const parts = [];
  for (let i = 0; i < blocks.length; i++) {
    const start = answer.indexOf(MARK(i));
    if (start < 0) return { applied: false, reason: "markers changed" };
    const end = i + 1 < blocks.length ? answer.indexOf(MARK(i + 1), start) : answer.length;
    if (end < 0) return { applied: false, reason: "markers changed" };
    parts.push(answer.slice(start + MARK(i).length, end).trim());
  }
  const verdict = acceptCleanup(blocks.map((b) => b.text).join("\n\n"), parts.join("\n\n"));
  if (!verdict.ok) return { applied: false, reason: verdict.reason };

  let changed = 0;
  const now = new Date();
  for (let i = 0; i < blocks.length; i++) {
    if (norm(parts[i]) === norm(blocks[i].text) && paragraphs(parts[i]).length === paragraphs(blocks[i].text).length) continue;
    const textmap = textToTextmap(parts[i]);
    const doc = await Occurrence.findOneAndUpdate({ id: blocks[i].occ.id, userId },
      { $set: { textmap: compressTextmap(textmap), updatedAt: now } }, { returnDocument: "after", lean: true });
    if (!doc) continue;
    const out = { ...doc, textmap };
    mirror?.("occurrence", out);
    io?.to?.(`user:${userId}`)?.emit?.("occurrence_updated", { occurrence: out });
    changed++;
  }
  const stamped = await Occurrence.findOneAndUpdate({ id: rootOccurrenceId, userId },
    { $set: { "meta.aiCleanedAt": now.toISOString() } }, { returnDocument: "after", lean: true });
  if (stamped) {
    const out = stamped.textmap ? { ...stamped, textmap: decompressTextmap(stamped.textmap) } : stamped;
    mirror?.("occurrence", out);
    io?.to?.(`user:${userId}`)?.emit?.("occurrence_updated", { occurrence: out });
  }
  return { applied: changed > 0, changed };
}
