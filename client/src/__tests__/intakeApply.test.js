// Task 3 (Step 1) of docs/superpowers/plans/2026-08-06-intake-links-and-artifacts.md.
//
// The router is the only file in the intake path that writes. Two things are
// worth holding here, and neither is "does the upload work" (that is
// artifactUpload's own contract):
//
//   1. THE COVERAGE CONTRACT. Task 1's rule: "a shape offered and not
//      implemented is worse than one not offered." A tile that does nothing is
//      a dead end where a drop used to work. So the sheet is only ever handed
//      shapes the router can carry out, and an unimplemented shape is a KNOWN
//      gap listed here rather than a silent one.
//   2. THE ROUTES REACH THE EXISTING HELPERS — Step 1 is behaviour-preserving,
//      so the test asserts each shape lands on the same helper the old
//      hard-coded path called, with the same arguments.
import { describe, it, expect, vi, beforeEach } from "vitest";

const createArtifactPlaceholders = vi.fn(() => [{ moduleId: "m1", occurrenceId: "o1" }]);
const uploadArtifactPlaceholders = vi.fn();
vi.mock("../helpers/artifactUpload", () => ({
  createArtifactPlaceholders: (...a) => createArtifactPlaceholders(...a),
  uploadArtifactPlaceholders: (...a) => uploadArtifactPlaceholders(...a),
}));

const {
  applyIntakeShape, filterToImplemented, assertShapeCoverage,
  IMPLEMENTED_SHAPE_IDS, INTAKE_ROUTES,
} = await import("../helpers/intakeApply.js");
const { classifyIntake, INTAKE_SHAPES, allIntakeShapeIds } = await import("../helpers/intake.js");

beforeEach(() => { vi.clearAllMocks(); });

describe("coverage contract", () => {
  it("every route points at a shape that actually exists", () => {
    // Catches a typo'd id, or a shape renamed out from under the router.
    expect(assertShapeCoverage().orphanRoutes).toEqual([]);
  });

  it("every route is a callable", () => {
    for (const [id, route] of Object.entries(INTAKE_ROUTES)) {
      expect(typeof route.run, `${id} has no run()`).toBe("function");
    }
  });

  it("names the shapes NOT yet implemented, so the gap is known rather than silent", () => {
    const { implemented, notImplemented } = assertShapeCoverage();
    expect(implemented.length + notImplemented.length).toBe(allIntakeShapeIds().length);
    // Step 1 is behaviour-preserving: only today's shapes are wired. This is a
    // deliberate, recorded gap — Task 5 lands the rest.
    expect(notImplemented).toContain(INTAKE_SHAPES.IMAGE_CANVAS.id);
    expect(notImplemented).toContain(INTAKE_SHAPES.LINK_CHIP.id);
    expect(implemented).toContain(INTAKE_SHAPES.FILE_ARTIFACT.id);
  });
});

describe("filterToImplemented — the sheet never shows a dead tile", () => {
  it("drops shapes the router cannot carry out", () => {
    // A png on a canvas offers artifact + canvas + outline; only artifact is wired.
    const c = classifyIntake({ files: [{ name: "a.png", type: "image/png" }] }, { kind: "canvas" });
    expect(c.shapes.map((s) => s.id)).toContain(INTAKE_SHAPES.IMAGE_CANVAS.id);

    const f = filterToImplemented(c);
    expect(f.shapes.every((s) => IMPLEMENTED_SHAPE_IDS.includes(s.id))).toBe(true);
    expect(f.shapes.map((s) => s.id)).not.toContain(INTAKE_SHAPES.IMAGE_CANVAS.id);
  });

  it("keeps the preselection when it survived", () => {
    const c = classifyIntake({ files: [{ name: "a.png", type: "image/png" }] }, { kind: "canvas" });
    expect(filterToImplemented(c).preselected).toBe(INTAKE_SHAPES.IMAGE_ARTIFACT.id);
  });

  it("re-points the preselection when it did NOT survive", () => {
    // A link preselects the chip, which Step 1 does not implement.
    const c = classifyIntake({ url: "https://example.com" });
    expect(c.preselected).toBe(INTAKE_SHAPES.LINK_CHIP.id);

    const f = filterToImplemented(c);
    expect(f.shapes.some((s) => s.id === f.preselected)).toBe(true);
  });

  it("NEVER returns zero shapes — a sheet with no options is worse than not asking", () => {
    const f = filterToImplemented({ payload: {}, shapes: [], preselected: null });
    expect(f.shapes.length).toBe(1);
    expect(f.preselected).toBe(INTAKE_SHAPES.FILE_ARTIFACT.id);

    // …and the fallback it picks is itself implemented (otherwise the escape
    // hatch would be its own dead end).
    expect(IMPLEMENTED_SHAPE_IDS).toContain(f.preselected);
  });
});

describe("applyIntakeShape — routes reach the EXISTING helpers unchanged", () => {
  const ctx = () => ({
    files: [{ name: "a.png", type: "image/png" }],
    gridId: "g1", userId: "u1", dispatch: vi.fn(), socket: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
    occExtra: () => ({ parentId: "cont-1" }),
    persist: () => ({ parentId: "cont-1" }),
    containerOccurrenceId: "cont-1",
  });

  it("an artifact shape mints placeholders then uploads them", () => {
    const c = ctx();
    const r = applyIntakeShape(INTAKE_SHAPES.FILE_ARTIFACT.id, c);
    expect(r.ok).toBe(true);
    expect(createArtifactPlaceholders).toHaveBeenCalledTimes(1);
    expect(createArtifactPlaceholders.mock.calls[0][0]).toBe(c.files);
    expect(createArtifactPlaceholders.mock.calls[0][1]).toMatchObject({ gridId: "g1", userId: "u1" });
    expect(uploadArtifactPlaceholders).toHaveBeenCalledTimes(1);
    expect(uploadArtifactPlaceholders.mock.calls[0][1]).toMatchObject({ containerOccurrenceId: "cont-1" });
  });

  it("image / file / many-files all take the same write today", () => {
    for (const id of [INTAKE_SHAPES.IMAGE_ARTIFACT.id, INTAKE_SHAPES.FILE_ARTIFACT.id, INTAKE_SHAPES.FILES_SIBLINGS.id]) {
      vi.clearAllMocks();
      applyIntakeShape(id, ctx());
      expect(createArtifactPlaceholders, `${id} did not mint placeholders`).toHaveBeenCalledTimes(1);
    }
  });

  it("writes nothing when there are no files", () => {
    applyIntakeShape(INTAKE_SHAPES.FILE_ARTIFACT.id, { ...ctx(), files: [] });
    expect(createArtifactPlaceholders).not.toHaveBeenCalled();
    expect(uploadArtifactPlaceholders).not.toHaveBeenCalled();
  });

  it("the doc-page shape emits import_text with the destination parent", () => {
    const socket = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    applyIntakeShape(INTAKE_SHAPES.TEXT_DOC_PAGE.id, {
      payload: { kind: "html", html: "<h1>Hi</h1><p>there</p>" },
      destination: { parentId: "page-1" },
      gridId: "g1", socket,
    });
    expect(socket.emit).toHaveBeenCalledTimes(1);
    const [event, body] = socket.emit.mock.calls[0];
    expect(event).toBe("import_text");
    expect(body).toMatchObject({ gridId: "g1", parentId: "page-1", format: "html" });
    expect(body.content).toContain("Hi");
  });

  it("the doc-page shape writes nothing for empty content", () => {
    const socket = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    applyIntakeShape(INTAKE_SHAPES.TEXT_DOC_PAGE.id, { payload: { kind: "text", text: "   " }, socket });
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it("an unrouted shape writes NOTHING and says so", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = applyIntakeShape(INTAKE_SHAPES.IMAGE_CANVAS.id, ctx());
    expect(r).toMatchObject({ ok: false, reason: "no-route" });
    expect(createArtifactPlaceholders).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
