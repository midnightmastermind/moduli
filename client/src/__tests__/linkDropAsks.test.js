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
      socket: { connected: true, emit: vi.fn(), on: vi.fn(), off: vi.fn() },
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

  it("falls back to the CHIP — the audit's headline finding, answered", () => {
    // Was LINK_INSTANCE while the chip was unimplemented (filterToImplemented
    // re-pointed the classifier's ideal pick at the only wired shape). Task 5
    // landed the chip, so the classifier's own fallback now stands: a
    // dropped link becomes a clickable chip, not a card labelled with a URL.
    // The plain card is still OFFERED — it is one keystroke away, not gone.
    const { dropContext, ctx } = makeCtx("https://example.com");
    handleExternalDrop(dropContext, ctx);
    expect(requests[0].classification.fallback).toBe(INTAKE_SHAPES.LINK_CHIP.id);
    expect(requests[0].classification.shapes.map(s => s.id)).toContain(INTAKE_SHAPES.LINK_INSTANCE.id);
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

  it("with no host, still WRITES — the FALLBACK runs rather than the drop vanishing", () => {
    // A preview iframe / test harness has no sheet host. The drop must not be
    // swallowed; it commits the fallback shape, which is now the chip.
    unregister?.(); unregister = null;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { dropContext, ctx } = makeCtx("https://example.com/y");
    handleExternalDrop(dropContext, ctx);
    const mods = ctx.dispatch.mock.calls
      .map(([a]) => a?.payload?.module).filter((m) => m?.role === "textblock");
    expect(mods).toHaveLength(1);
    expect(mods[0].meta).toEqual({ link: { kind: "url", url: "https://example.com/y" } });
    warn.mockRestore();
  });
});

// The HTML / long-text branch asks too. Today's outcome (the whole tree via
// import_text) stays the no-host FALLBACK, so a sheetless drop reproduces what this
// branch did on its own — the ask only decides WHETHER to run it.
describe("dropping HTML / long text ASKS", () => {
  function htmlCtx(html) {
    const containerMod = { id: "cm", role: "container", kind: "board", label: "Notes" };
    return {
      dropContext: {
        payload: { payloadType: DragType.TEXT, data: { text: "" } },
        target: { occurrenceId: "co", moduleId: "cm" },
        pointer: { x: 10, y: 20 },
        position: { edge: null, insertIndex: -1 },
        dataTransfer: { getData: (t) => (t === "text/html" ? html : "") },
      },
      ctx: {
        dispatch: vi.fn(),
        socket: { connected: true, emit: vi.fn(), on: vi.fn(), off: vi.fn() },
        state: { gridId: "g1", userId: "u1", grid: { _id: "g1" }, modulesById: { cm: containerMod }, viewsById: {} },
        occurrencesById: { co: { id: "co", moduleId: "cm", occurrences: [] } },
        baseContainers: [containerMod],
        clearSession: vi.fn(),
        getCellFromPoint: () => null,
      },
    };
  }
  const HTML = "<h1>Title</h1><p>Body text that is long enough to import.</p>";

  // Still today's OUTCOME — the tree lands in the container it was dropped on.
  // The fallback shape id changed because that outcome now has its own name:
  // `text-doc-page` used to produce this and is, as of this change, the one that
  // actually wraps the tree in a page (see helpers/intakeApply).
  it("opens the sheet; the tree in place is the fallback (today's outcome)", () => {
    const { dropContext, ctx } = htmlCtx(HTML);
    handleExternalDrop(dropContext, ctx);
    expect(requests).toHaveLength(1);
    expect(requests[0].classification.fallback).toBe(INTAKE_SHAPES.TEXT_CONTAINER_TREE.id);
  });

  it("writes nothing until picked, and nothing at all on cancel", () => {
    const { dropContext, ctx } = htmlCtx(HTML);
    handleExternalDrop(dropContext, ctx);
    expect(ctx.socket.emit).not.toHaveBeenCalled();
    requests[0].onCancel();
    expect(ctx.socket.emit).not.toHaveBeenCalled();
  });

  it("picking it runs the SAME import_text the branch used to run inline", () => {
    const { dropContext, ctx } = htmlCtx(HTML);
    handleExternalDrop(dropContext, ctx);
    requests[0].onPick(INTAKE_SHAPES.TEXT_DOC_PAGE.id);
    const call = ctx.socket.emit.mock.calls.find(c => c[0] === "import_text");
    expect(call).toBeTruthy();
    expect(call[1]).toMatchObject({ gridId: "g1", format: "html", parentId: "co" });
    expect(call[1].content).toContain("Title");
  });
});

// ── THE DROP HANDLER IS A CALL SITE FOR THE ANSWER TOO ──────────────────────
// `link-field-value` is the first shape whose outcome depends on a SECOND
// answer, and the sheet hands that answer back as onPick's second argument.
// Every caller has to forward it. An A/B proved this needs its own test:
// deleting `answer` from this handler's onPick left every other suite green
// while the chosen field was dropped on the floor — the same class as the
// missing dispatch/userId, destinationModule and onIntakeResult before it.
describe("a link dropped on a ROW can fill one of its fields", () => {
  function rowCtx(url = "https://example.com/profile") {
    const c = makeCtx(url);
    // A row that binds two text fields: Website and LinkedIn. There is no link
    // field TYPE, so both are candidates and the user picks (helpers/intakeFields).
    c.ctx.state.modulesById.containerMod = {
      id: "containerMod", role: "container", kind: "board", label: "People",
      fieldBindings: [{ fieldId: "f-web" }, { fieldId: "f-li" }, { fieldId: "f-age" }],
    };
    c.ctx.state.fields = [
      { id: "f-web", name: "Website", type: "text" },
      { id: "f-li", name: "LinkedIn", type: "text" },
      { id: "f-age", name: "Age", type: "number" },   // cannot hold a URL
    ];
    return c;
  }

  it("offers the shape, with only the TEXT fields as its follow-up", () => {
    const { dropContext, ctx } = rowCtx();
    handleExternalDrop(dropContext, ctx);
    const shape = requests[0].classification.shapes
      .find((s) => s.id === INTAKE_SHAPES.LINK_FIELD_VALUE.id);
    expect(shape, "the shape was not offered").toBeTruthy();
    expect(shape.followUp.options.map((o) => o.value)).toEqual(["f-web", "f-li"]);
  });

  it("FORWARDS the chosen field, and the URL lands in it", () => {
    const { dropContext, ctx } = rowCtx();
    handleExternalDrop(dropContext, ctx);
    requests[0].onPick(INTAKE_SHAPES.LINK_FIELD_VALUE.id, "f-li");

    const write = ctx.socket.emit.mock.calls.find(([ev]) => ev === "update_occurrence");
    expect(write, "no field write left the client").toBeTruthy();
    expect(write[1].occurrence.fields["f-li"])
      .toEqual({ value: "https://example.com/profile", flow: "in" });
  });

  it("is NOT offered on a row with no text fields to fill", () => {
    const { dropContext, ctx } = rowCtx();
    ctx.state.fields = [{ id: "f-age", name: "Age", type: "number" }];
    handleExternalDrop(dropContext, ctx);
    const ids = requests[0].classification.shapes.map((s) => s.id);
    expect(ids).not.toContain(INTAKE_SHAPES.LINK_FIELD_VALUE.id);
  });
});
