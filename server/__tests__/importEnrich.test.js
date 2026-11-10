// server/__tests__/importEnrich.test.js — plan Task 7: Ollama may only fix misreads, after saving.
import { describe, it, expect, vi, beforeEach } from "vitest";

const store = new Map();
const writes = [];
vi.mock("../models/Occurrence.js", () => ({ default: {
  findOne: (q) => ({ lean: async () => structuredClone(store.get(q.id) || null) }),
  find: (q) => ({ lean: async () => (q.id?.$in || []).map((id) => store.get(id)).filter(Boolean).map((o) => structuredClone(o)) }),
  findOneAndUpdate: async (q, u) => {
    const row = store.get(q.id); if (!row) return null;
    writes.push({ id: q.id, set: u.$set });
    for (const [k, v] of Object.entries(u.$set)) { if (k.startsWith("meta.")) row.meta = { ...(row.meta || {}), [k.slice(5)]: v }; else row[k] = v; }
    return structuredClone(row);
  },
}}));
vi.mock("../models/Module.js", () => ({ default: {
  find: () => ({ lean: async () => [{ id: "m-root", role: "container" }, { id: "m-tb", role: "textblock" }, { id: "m-tb2", role: "textblock" }] }),
}}));

const { acceptCleanup, enrichImport, simpleBlockText } = await import("../services/importEnrich.js");

const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const BODY = "Gnosis is conscious knowledge. The word can refer to the knowledge we acquire through our own experience.";

beforeEach(() => {
  store.clear(); writes.length = 0;
  store.set("root", { id: "root", userId: "u", moduleId: "m-root", occurrences: ["tb1", "tb2"], meta: { importSource: { kind: "image" } } });
  store.set("tb1", { id: "tb1", userId: "u", moduleId: "m-tb", textmap: { type: "doc", content: [para("I know! | don't know what I think.")] } });
  store.set("tb2", { id: "tb2", userId: "u", moduleId: "m-tb2", textmap: { type: "doc", content: [para(BODY)] } });
});
const ollamaSays = (text) => async () => ({ ok: true, json: async () => ({ message: { content: text } }) });

describe("acceptCleanup", () => {
  it("a misread | fixed is accepted", () => {
    expect(acceptCleanup("I know! | don't", "I know! I don't")).toEqual({ ok: true });
  });
  it("whitespace alone is no change", () => {
    expect(acceptCleanup("a  b\nc", "a b c").ok).toBe(true);
  });
  it("a reworded phrase is refused", () => {
    expect(acceptCleanup(BODY, BODY.replace("conscious knowledge", "aware understanding")).ok).toBe(false);
  });
  it("a dropped sentence is refused", () => {
    expect(acceptCleanup(BODY, "Gnosis is conscious knowledge.").ok).toBe(false);
  });
  it("a translated paragraph is refused", () => {
    expect(acceptCleanup(BODY, "La gnosis es conocimiento consciente. La palabra puede referirse al conocimiento que adquirimos.").ok).toBe(false);
  });
  it("a broken word rejoined is accepted", () => {
    expect(acceptCleanup("the know- ledge we gain", "the knowledge we gain").ok).toBe(true);
  });
});

describe("enrichImport", () => {
  it("Ollama down or slow: nothing written", async () => {
    const r = await enrichImport({ rootOccurrenceId: "root", gridId: "g", userId: "u" },
      { fetch: async (_u, { signal }) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("abort")))), timeoutMs: 20 });
    expect(r).toEqual({ applied: false, reason: "ollama" });
    expect(writes).toHaveLength(0);
  });
  it("a rewrite is refused: nothing written", async () => {
    const r = await enrichImport({ rootOccurrenceId: "root", gridId: "g", userId: "u" },
      { fetch: ollamaSays(`[[[0]]]\nI know! I don't know what I think.\n\n[[[1]]]\n${BODY.replace("conscious knowledge", "aware understanding")}`) });
    expect(r.applied).toBe(false);
    expect(writes).toHaveLength(0);
  });
  it("a fixed | is one write, and the root is stamped", async () => {
    const r = await enrichImport({ rootOccurrenceId: "root", gridId: "g", userId: "u" },
      { fetch: ollamaSays(`[[[0]]]\nI know! I don't know what I think.\n\n[[[1]]]\n${BODY}`) });
    expect(r).toEqual({ applied: true, changed: 1 });
    const textWrites = writes.filter((w) => "textmap" in w.set);
    expect(textWrites.map((w) => w.id)).toEqual(["tb1"]);
    expect(store.get("root").meta.aiCleanedAt).toBeTruthy();
  });
  it("markers the model dropped: refused", async () => {
    const r = await enrichImport({ rootOccurrenceId: "root", gridId: "g", userId: "u" },
      { fetch: ollamaSays(`I know! I don't know what I think.\n\n${BODY}`) });
    expect(r).toEqual({ applied: false, reason: "markers changed" });
  });
});

describe("simpleBlockText", () => {
  it("a block with a link mark is not cleaned — the control", () => {
    expect(simpleBlockText({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link" }] }] }] })).toBeNull();
    expect(simpleBlockText({ type: "doc", content: [para("a"), para("b")] })).toBe("a\n\nb");
  });
});
