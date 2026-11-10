// services/importPreview.js
//
// WHAT AUTO WILL CREATE, said before Clip is pressed (smarter imports Task 5). The preview is the import
// pipeline itself in dry-run mode, so what the window shows is what is written. Rules only — Ollama
// clean-up runs after saving and the window says so (AI_NOTE).
import { runImport } from "./importPipeline.js";

export const AI_NOTE = "AI clean-up will run after saving";
export const PREVIEW_TIMEOUT_MS = 8000;
const MAX_BODY_LINES = 8;

const isHttp = (u) => typeof u === "string" && /^https?:\/\//i.test(u);

/** A staged clip -> an import source, or null when it holds nothing a page can be made from. Pure. */
export function stageImportSource(payload = {}) {
  const file = payload.file;
  if (file?.path && /^image\//.test(file.mimetype || "")) return { kind: "image", filePath: file.path };
  if (payload.shape === "image" && isHttp(payload.url)) return { kind: "image", filePath: payload.url, url: payload.url };
  const url = [payload.url, payload.clip?.moduleFileRef].find(isHttp);
  if (url && payload.clip?.meta?.clipShape !== "selection") return { kind: "link", url };
  const text = String(payload.text || payload.clip?.meta?.selection || "").trim();
  if (text) return { kind: "text", text, title: payload.title || null };
  return null;
}

/** The page's first readable lines: pictures dropped, heading / quote markers stripped. Pure. */
export function bodyLinesOf(markdown, max = MAX_BODY_LINES) {
  const out = [];
  for (const raw of String(markdown || "").split("\n")) {
    const line = raw.trim();
    if (!line || /^!\[[^\]]*\]\([^)]*\)$/.test(line)) continue;
    out.push(line.replace(/^#{1,6}\s+/, "").replace(/^>\s?/, "").replace(/\*\*|__/g, ""));
    if (out.length >= max) break;
  }
  return out;
}

/** The label a clip has before any page is read. */
export function stageLabel(payload = {}) {
  return payload.title || payload.clip?.label || payload.url || String(payload.text || "").split("\n")[0].slice(0, 120) || "Shared item";
}

/**
 * The preview for one staged clip. Never throws: an unreachable page answers willBuildPage:false with the
 * stage's label; a read slower than `timeoutMs` answers partial:true. @param deps passed to runImport.
 */
export async function buildImportPreview(payload, deps = {}, { timeoutMs = PREVIEW_TIMEOUT_MS } = {}) {
  const base = { where: "Imports", label: stageLabel(payload), type: null, board: null, fields: {},
    bodyLines: [], images: [], willBuildPage: false, aiNote: AI_NOTE };
  const source = stageImportSource(payload);
  if (!source) return base;
  base.type = source.kind;
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); });
  let out;
  try {
    out = await Promise.race([runImport({ source, userId: "preview", gridId: null, dryRun: true }, deps), timeout]);
  } catch (err) {
    clearTimeout(timer);
    return { ...base, error: String(err?.message || err) };
  }
  clearTimeout(timer);
  if (out === "timeout") return { ...base, partial: true };
  const images = (out.meta?.images || []).map((im) => im.url).filter(isHttp);
  return {
    ...base,
    label: out.meta?.title || base.label,
    type: out.meta?.type || source.kind,
    bodyLines: out.empty ? [] : bodyLinesOf(out.markdown),
    images,
    willBuildPage: !out.empty,
  };
}
