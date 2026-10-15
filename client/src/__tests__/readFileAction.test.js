import { describe, it, expect, vi } from "vitest";
const readFileText = vi.fn(async () => ({ text: "OCTOBER 15\n\nThe fifteenth.", found: true }));

import { executeActionItem } from "../helpers/operationActions";
import { executePipeline } from "../helpers/operationExecutor";
import { operationsBridge } from "../state/bindSocketToStore";
operationsBridge.readFileText = (...a) => readFileText(...a);

const ctx = () => ({
  state: {},
  fieldsById: { fFiles: { id: "fFiles", name: "Files" } },
  modulesById: {
    mRow: { id: "mRow", role: "artifact", kind: "book", fileRef: null, fieldBindings: [{ fieldId: "fFiles", role: "files" }] },
    mPdf: { id: "mPdf", role: "artifact", kind: "pdf", fileRef: "gdrive:c:dr" },
  },
  occurrencesById: {
    row: { id: "row", moduleId: "mRow", fields: { fFiles: { value: ["pdf1"], main: "pdf1" } } },
    pdf1: { id: "pdf1", moduleId: "mPdf" },
  },
});

describe("READ_FILE", () => {
  it("resolves a BOOK ROW to its file and asks for the passage", () => {
    const out = executeActionItem("READ_FILE", { file: "literal:row", from: "/^${$md}\\b/im", to: "/^[a-z]+ \\d+/im" }, { $md: "October 15" }, ctx(), {});
    expect(out[0]).toMatchObject({ _suspend: true, _readFile: true, resultVar: "$fileText" });
    expect(out[0].request).toMatchObject({ src: "/files/c/dr", kind: "pdf", from: "/^October 15\\b/im" });
  });
  it("reads a file REFERENCE directly (its row may not be loaded yet)", () => {
    const out = executeActionItem("READ_FILE", { file: "literal:gdrive:c:dr", kind: "pdf", from: "October 15" }, {}, ctx(), {});
    expect(out[0].request).toMatchObject({ src: "/files/c/dr", kind: "pdf" });
  });
  it("a row with no readable file binds found:false instead of suspending", () => {
    const c = ctx(); c.occurrencesById.row.fields = {};
    const $vars = {};
    const out = executeActionItem("READ_FILE", { file: "literal:row" }, $vars, c, {});
    expect(out).toEqual([]);
    expect($vars.$fileText.found).toBe(false);
  });
  it("a pipeline waits for the read, then later steps see $fileText", async () => {
    const op = { id: "op", name: "t", pipeline: { sources: [], steps: [
      { id: "s1", type: "action", config: { type: "READ_FILE", file: "literal:pdf1", from: "October 15" } },
      { id: "s2", type: "action", config: { type: "SHOW_VALUE", name: "got", value: "$fileText.text" } },
    ] } };
    const done = new Promise((resolve) => {
      executePipeline(op, { ...ctx(), _onPipelineDone: resolve }, { type: "ManualOp" });
    });
    const effects = await done;
    const shown = (effects || []).find((e) => e._effect === "SHOW_VALUE");
    expect(shown?.value).toBe("OCTOBER 15\n\nThe fifteenth.");
  });
});
