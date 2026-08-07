// The audit's HEADLINE finding: a dropped link became an instance whose label
// was the raw URL — silently, with no way to ask for anything better, even
// though the importer could already build the whole page from that URL and
// nothing routed to it.
//
// Now it asks. Two shapes are real here:
//   • "Plain item"      — today's behaviour, kept so the decision layer is
//                         genuinely behaviour-preserving rather than a rewrite
//   • "Import the page" — newly possible, because import_url landed 2026-08-07
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleExternalDrop } from "../helpers/dropHandlers";
import { registerIntakeSheetHost } from "../ui/IntakeSheet";
import { INTAKE_SHAPES } from "../helpers/intake";
import { DragType } from "../helpers/dragSystem";
import * as LayoutHelpers from "../helpers/LayoutHelpers";

function makeCtx(url) {
  const containerMod = { id: "containerMod", role: "container", kind: "board", label: "Reading" };
  const occs = { containerOcc: { id: "containerOcc", moduleId: "containerMod", occurrences: [] } };
  return {
    dropContext: {
      payload: { payloadType: DragType.URL, data: { url } },
      target: { occurrenceId: "containerOcc", moduleId: "containerMod" },
      pointer: { x: 40, y: 60 },
      position: { edge: null, insertIndex: -1 },
      dataTransfer: { getData: () => "" },
    },
    ctx: {
      dispatch: vi.fn(),
      socket: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
      state: { gridId: "g1", userId: "u1", grid: { _id: "g1" }, modulesById: { containerMod }, viewsById: {} },
      occurrencesById: occs,
      baseContainers: [containerMod],
      clearSession: vi.fn(),
      getCellFromPoint: () => null,
    },
  };
}

let requests, unregister, createSpy;
beforeEach(() => {
  requests = [];
  unregister = registerIntakeSheetHost((r) => { if (r) requests.push(r); });
  createSpy = vi.spyOn(LayoutHelpers, "createInstanceInContainer").mockReturnValue({ occurrence: { id: "new" } });
});
afterEach(() => { unregister?.(); vi.restoreAllMocks(); });

describe("dropping a link ASKS", () => {
  it("opens the sheet instead of silently making a card", () => {
    const { dropContext, ctx } = makeCtx("https://en.wikipedia.org/wiki/Eminem");
    handleExternalDrop(dropContext, ctx);
    expect(requests).toHaveLength(1);
  });

  it("offers today's card AND importing the page", () => {
    const { dropContext, ctx } = makeCtx("https://example.com/article");
    handleExternalDrop(dropContext, ctx);
    const ids = requests[0].classification.shapes.map(s => s.id);
    expect(ids).toContain(INTAKE_SHAPES.LINK_INSTANCE.id);
    expect(ids).toContain(INTAKE_SHAPES.LINK_PAGE.id);
  });

  it("pre-selects TODAY'S behaviour — the good shape is opt-IN, not a surprise", () => {
    // The classifier's ideal pick is the chip, which Task 5 owns; until then
    // the filter re-points to the plain card so nothing changes by default.
    const { dropContext, ctx } = makeCtx("https://example.com");
    handleExternalDrop(dropContext, ctx);
    expect(requests[0].classification.preselected).toBe(INTAKE_SHAPES.LINK_INSTANCE.id);
  });

  it("WRITES NOTHING until a shape is picked", () => {
    const { dropContext, ctx } = makeCtx("https://example.com");
    handleExternalDrop(dropContext, ctx);
    expect(createSpy).not.toHaveBeenCalled();
    expect(ctx.socket.emit).not.toHaveBeenCalled();
  });

  it("picking the plain card reproduces the old write, label and all", () => {
    const { dropContext, ctx } = makeCtx("https://example.com/x");
    handleExternalDrop(dropContext, ctx);
    requests[0].onPick(INTAKE_SHAPES.LINK_INSTANCE.id);
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0][0].instance.label).toBe("https://example.com/x");
  });

  it("picking 'Import the page' fetches it instead", () => {
    const { dropContext, ctx } = makeCtx("https://example.com/article");
    handleExternalDrop(dropContext, ctx);
    requests[0].onPick(INTAKE_SHAPES.LINK_PAGE.id);
    expect(createSpy).not.toHaveBeenCalled();
    const [event, body] = ctx.socket.emit.mock.calls[0];
    expect(event).toBe("import_url");
    expect(body).toMatchObject({ url: "https://example.com/article", gridId: "g1", parentId: "containerOcc" });
  });

  it("CANCELLING writes nothing", () => {
    const { dropContext, ctx } = makeCtx("https://example.com");
    handleExternalDrop(dropContext, ctx);
    requests[0].onCancel();
    expect(createSpy).not.toHaveBeenCalled();
    expect(ctx.socket.emit).not.toHaveBeenCalled();
    expect(ctx.clearSession).toHaveBeenCalled();
  });

  it("with no host, falls back to today's card", () => {
    unregister?.(); unregister = null;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { dropContext, ctx } = makeCtx("https://example.com/y");
    handleExternalDrop(dropContext, ctx);
    expect(createSpy).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
