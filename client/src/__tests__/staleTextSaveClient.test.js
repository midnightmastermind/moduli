// @vitest-environment jsdom
// The client half of refusing a text save built on old text
// (server/utils/textmapDigest, server/__tests__/staleTextSave.test.js):
// the save carries its editor's basis, and a refused save makes that editor
// show the server's copy past its guards.
import { describe, test, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { updateOccurrence } from "../helpers/CommitHelpers";
import {
  requestEditorAdopt, hasEditorAdopt, clearEditorAdopt, getOperationWriteToken, _resetForceSync,
} from "../helpers/editorSyncSignal";

const mocks = () => ({ dispatch: vi.fn(), socket: { emit: vi.fn(), connected: true } });
const sent = (socket) => socket.emit.mock.calls.find(([e]) => e === "update_occurrence")?.[1];

describe("a text save carries its basis", () => {
  test("textmapBasis rides on the payload of a text write", () => {
    const { dispatch, socket } = mocks();
    updateOccurrence({ dispatch, socket, occurrence: { id: "o", textmap: { type: "doc" } }, textmapBasis: "b1" });
    expect(sent(socket).textmapBasis).toBe("b1");
  });
  test("…and never on a write that carries no text", () => {
    const { dispatch, socket } = mocks();
    updateOccurrence({ dispatch, socket, occurrence: { id: "o", fields: {} }, textmapBasis: "b1" });
    expect(sent(socket).textmapBasis).toBeUndefined();
  });
});

describe("a refused save asks its editor to adopt the server copy", () => {
  beforeEach(() => _resetForceSync());
  test("mark, notify, expire", () => {
    const t0 = getOperationWriteToken();
    requestEditorAdopt("o", 1000);
    expect(getOperationWriteToken()).toBe(t0 + 1);   // re-runs the editor's sync effect
    expect(hasEditorAdopt("o", 1001)).toBe(true);
    expect(hasEditorAdopt("other", 1001)).toBe(false);
    expect(hasEditorAdopt("o", 1000 + 3001)).toBe(false);
  });
  test("cleared once applied", () => {
    requestEditorAdopt("o");
    clearEditorAdopt("o");
    expect(hasEditorAdopt("o")).toBe(false);
  });
});

describe("wiring", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, p), "utf8");
  test("the editor sends its basis and moves it on save and on adopt", () => {
    const ed = read("../ui/Editor.jsx");
    expect(ed).toMatch(/textmapBasis: textBasisRef\.current/);
    expect(ed).toMatch(/textBasisRef\.current = textmapDigest\(json\)/);
    expect(ed).toMatch(/const forced = forceSyncToken !== appliedForceSyncRef\.current \|\| adopt;/);
    expect((ed.match(/textBasisRef\.current = textmapDigest\(content\)/g) || []).length).toBe(2);
    // The adopt is spent only where the server copy is APPLIED — spending it when
    // the editor merely equals `content` dropped it on the render that still
    // carried the refused text (watched on prod, 2026-10-02).
    expect((ed.match(/clearEditorAdopt\(occurrence\.id\)/g) || []).length).toBe(1);
  });
  test("a refused TEXT save is what requests the adopt", () => {
    const b = read("../state/bindSocketToStore.js");
    expect(b).toMatch(/if \(reason === "textmap"\) requestEditorAdopt\(occurrence\.id\)/);
  });
});

// A click-minted textblock is built on an EMPTY doc. Its first keystroke runs
// commitProvisionalTextblock, whose create stores the text typed so far — so the
// stored text is no longer the empty doc the editor was built on. Before
// 2026-10-07 the basis stayed on the empty doc, the next save ("Ris" after "R")
// was refused as stale, and the editor adopted "R": every new block kept only
// its first character (prod log: one "REFUSED stale text" per new block).
describe("a provisional block's commit moves its basis", () => {
  const { textSaveIsStale } = require("../../../server/socketHandlers/occurrences.js");
  const { textmapDigest } = require("../../../server/utils/textmapDigest.js");
  const doc = (t) => ({ type: "doc", content: [{ type: "paragraph", content: t ? [{ type: "text", text: t }] : undefined }] });
  const stored = textmapDigest(doc("R"));              // what the create wrote
  test("control: a save still built on the empty doc is refused", () => {
    expect(textSaveIsStale({ basis: textmapDigest(doc("")), incoming: textmapDigest(doc("Ris")), stored })).toBe(true);
  });
  test("a save built on the committed text is accepted", () => {
    expect(textSaveIsStale({ basis: textmapDigest(doc("R")), incoming: textmapDigest(doc("Ris")), stored })).toBe(false);
  });
  test("wiring: the commit branch sets the basis to the committed text", () => {
    const ed = fs.readFileSync(path.join(__dirname, "../ui/Editor.jsx"), "utf8");
    const i = ed.indexOf("commitProvisionalTextblock(occurrence.id, json)");
    expect(i).toBeGreaterThan(0);
    expect(ed.slice(i, i + 400)).toMatch(/textBasisRef\.current = textmapDigest\(json\)/);
  });
});
