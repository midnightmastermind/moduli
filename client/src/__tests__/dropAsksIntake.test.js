// Task 3 Step 1 of docs/superpowers/plans/2026-08-06-intake-links-and-artifacts.md —
// the drop now ASKS.
//
// The plan's pass condition for this step is deliberately unglamorous:
// **nothing changes yet**. The sheet opens, the no-host fallback is today's
// outcome, and picking it writes exactly what the hard-coded path used to
// write. That is what proves the decision layer is transparent before any new
// shape rides on it.
//
// The existing handleFileDrop suite already covers the WRITES. What it cannot
// see is the ask, because no host is mounted there — so it silently exercises
// the fallback. These tests mount a host and pin the three things that only
// matter once something asks:
//
//   1. the sheet opens once for the whole gesture, with NOTHING pre-selected
//   2. picking it writes what the old path wrote
//   3. CANCELLING WRITES NOTHING — and nothing was minted before the ask, so
//      there is no debris to clean up either
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleFileDrop } from "../helpers/dropHandlers";
import { registerIntakeSheetHost } from "../ui/IntakeSheet";
import * as UploadHelpers from "../helpers/uploadWithProgress";
import { INTAKE_SHAPES } from "../helpers/intake";

const file = (name, type = "image/png") => ({ name, type, size: 10 });

function makeCtx(files) {
  const modules = {
    panelMod: { id: "panelMod", role: "panel", kind: "board" },
    containerMod: { id: "containerMod", role: "container", kind: "board" },
  };
  const occs = {
    panelOcc: { id: "panelOcc", moduleId: "panelMod", occurrences: ["containerOcc"] },
    containerOcc: { id: "containerOcc", moduleId: "containerMod", occurrences: ["existingChild"] },
  };
  return {
    dropContext: {
      payload: { data: { files } },
      target: { occurrenceId: "containerOcc", moduleId: "containerMod" },
      pointer: { x: 120, y: 240 },
      position: { edge: null, insertIndex: -1 },
    },
    ctx: {
      dispatch: vi.fn(),
      socket: { emit: vi.fn() },
      state: { gridId: "g1", userId: "u1", grid: { _id: "g1" }, modulesById: modules, viewsById: {} },
      occurrencesById: occs,
      baseContainers: [modules.containerMod],
      clearSession: vi.fn(),
      getCellFromPoint: () => ({ row: 0, col: 0 }),
    },
  };
}

let requests, unregister, uploadSpy;

beforeEach(() => {
  requests = [];
  unregister = registerIntakeSheetHost((r) => { if (r) requests.push(r); });
  uploadSpy = vi.spyOn(UploadHelpers, "uploadFileWithProgress").mockResolvedValue({
    module: { id: "m", fileRef: "f" }, occurrence: { id: "o" },
  });
});
afterEach(() => { unregister?.(); vi.restoreAllMocks(); });

describe("a file drop ASKS before it writes", () => {
  it("opens the sheet instead of deciding silently", () => {
    const { dropContext, ctx } = makeCtx([file("a.png")]);
    handleFileDrop(dropContext, ctx);
    expect(requests).toHaveLength(1);
    expect(requests[0].classification.shapes.length).toBeGreaterThan(0);
  });

  it("the no-host fallback is TODAY'S behaviour, so a sheetless drop is unchanged", () => {
    const { dropContext, ctx } = makeCtx([file("a.png")]);
    handleFileDrop(dropContext, ctx);
    expect(requests[0].classification.fallback).toBe(INTAKE_SHAPES.IMAGE_ARTIFACT.id);
  });

  it("asks ONCE for a nine-file gesture, not once per file", () => {
    const files = Array.from({ length: 9 }, (_, i) => file(`f${i}.png`));
    const { dropContext, ctx } = makeCtx(files);
    handleFileDrop(dropContext, ctx);
    expect(requests).toHaveLength(1);
    expect(requests[0].classification.payload.files).toHaveLength(9);
    expect(requests[0].classification.fallback).toBe(INTAKE_SHAPES.FILES_SIBLINGS.id);
  });

  it("only offers shapes the router can carry out", () => {
    const { dropContext, ctx } = makeCtx([file("a.png")]);
    handleFileDrop(dropContext, ctx);
    // The canvas/outline shapes exist in the classifier but Step 1 does not
    // implement them — a tile that does nothing is worse than no tile.
    const ids = requests[0].classification.shapes.map(s => s.id);
    expect(ids).not.toContain(INTAKE_SHAPES.IMAGE_CANVAS.id);
    expect(ids).not.toContain(INTAKE_SHAPES.IMAGE_OUTLINE.id);
  });

  it("WRITES NOTHING until a shape is picked", () => {
    const { dropContext, ctx } = makeCtx([file("a.png")]);
    handleFileDrop(dropContext, ctx);
    // No placeholders minted, no upload started — the ask happens BEFORE any
    // write, which is what makes cancelling free.
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it("CANCELLING writes nothing and leaves no debris", () => {
    const { dropContext, ctx } = makeCtx([file("a.png")]);
    handleFileDrop(dropContext, ctx);
    requests[0].onCancel();
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(ctx.socket.emit).not.toHaveBeenCalled();
  });

  it("picking the fallback shape mints and uploads, as before", () => {
    const { dropContext, ctx } = makeCtx([file("a.png"), file("b.png")]);
    handleFileDrop(dropContext, ctx);
    requests[0].onPick(requests[0].classification.fallback);

    // 2 files → module + occurrence dispatched per file, one upload each.
    expect(ctx.dispatch.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(uploadSpy).toHaveBeenCalledTimes(2);
  });

  it("anchors the sheet at the drop point", () => {
    const { dropContext, ctx } = makeCtx([file("a.png")]);
    handleFileDrop(dropContext, ctx);
    expect(requests[0].position).toMatchObject({ top: 248, left: 128 });
  });
});

describe("no host mounted", () => {
  it("falls back to today's behaviour rather than dropping the file on the floor", () => {
    unregister?.();          // simulate a preview iframe / harness with no host
    unregister = null;
    const { dropContext, ctx } = makeCtx([file("a.png")]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    handleFileDrop(dropContext, ctx);
    expect(uploadSpy).toHaveBeenCalledTimes(1);   // the file still lands
    warn.mockRestore();
  });
});
