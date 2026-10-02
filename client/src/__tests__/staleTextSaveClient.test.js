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
  });
  test("a refused TEXT save is what requests the adopt", () => {
    const b = read("../state/bindSocketToStore.js");
    expect(b).toMatch(/if \(reason === "textmap"\) requestEditorAdopt\(occurrence\.id\)/);
  });
});
