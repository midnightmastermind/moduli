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

// tesseract is a 3.5MB lazy import and OCR is seconds of real work — the route's
// contract is what it does with the text, not the reading.
const runOcr = vi.fn(async () => "");
vi.mock("../helpers/ocr", () => ({ runOcr: (...a) => runOcr(...a) }));

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
    expect(notImplemented).toContain(INTAKE_SHAPES.LINK_BOOKMARK.id);
    expect(implemented).toContain(INTAKE_SHAPES.FILE_ARTIFACT.id);
    // Landed in Task 5: the link chip and the two file-content shapes.
    expect(implemented).toContain(INTAKE_SHAPES.LINK_CHIP.id);
    expect(implemented).toContain(INTAKE_SHAPES.FILE_MARKDOWN_IMPORT.id);
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

  it("the container-tree shape emits import_text with the destination parent", () => {
    const socket = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    applyIntakeShape(INTAKE_SHAPES.TEXT_CONTAINER_TREE.id, {
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

  it("the container-tree shape refuses when there is nowhere to put the tree", () => {
    const socket = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    const onImportResult = vi.fn();
    applyIntakeShape(INTAKE_SHAPES.TEXT_CONTAINER_TREE.id, {
      payload: { kind: "text", text: "a paragraph long enough to import" },
      destination: { parentId: null }, gridId: "g1", socket, onImportResult,
    });
    expect(socket.emit).not.toHaveBeenCalled();
    expect(onImportResult).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it("the doc-page shape writes nothing for empty content", () => {
    const socket = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    applyIntakeShape(INTAKE_SHAPES.TEXT_DOC_PAGE.id, { payload: { kind: "text", text: "   " }, socket });
    expect(socket.emit).not.toHaveBeenCalled();
  });

  // The pair only earns two tiles if they write DIFFERENT things. Asserted on
  // the writes that LEAVE rather than on which helper ran, because the whole
  // failure this shape exists to avoid — a root listed but never embedded — is
  // invisible from the call side.
  describe("the doc-page shape wraps the tree in a page", () => {
    function run() {
      const emitted = [];
      const socket = {
        connected: true,
        emit: vi.fn((event, data) => emitted.push({ event, data })),
        on: vi.fn(), off: vi.fn(),
      };
      const destinationOccurrence = { id: "c1", moduleId: "cm", occurrences: [] };
      applyIntakeShape(INTAKE_SHAPES.TEXT_DOC_PAGE.id, {
        payload: { kind: "html", html: "<h1>Hi</h1><p>there</p>", text: "Hi\nthere" },
        destination: { parentId: "c1" },
        destinationOccurrence,
        destinationModule: { id: "cm", meta: { cover: "keep-me" } },
        gridId: "g1", userId: "u1", dispatch: vi.fn(), socket,
      });
      // The server's ack is what the page mint waits on.
      const ack = socket.on.mock.calls.find(([ev]) => ev === "import_text_result")?.[1];
      ack?.({ ok: true, rootOccurrenceId: "root-1" });
      return { emitted, socket };
    }

    it("imports DETACHED, so the root has exactly one home", () => {
      const { emitted } = run();
      const imp = emitted.find((e) => e.event === "import_text");
      expect(imp.data.parentId).toBeNull();
    });

    it("mints a doc page and EMBEDS the root in it, not just lists it", () => {
      const { emitted } = run();
      const page = emitted.find((e) => e.event === "create_module" && e.data.module?.role === "page");
      expect(page?.data.module.kind).toBe("doc");

      const patch = emitted
        .filter((e) => e.event === "update_occurrence" && e.data.occurrence?.textmap)
        .pop();
      expect(patch, "the page was never given a body").toBeTruthy();
      expect(patch.data.occurrence.occurrences).toEqual(["root-1"]);
      // Listed AND embedded — a doc renders its textmap, so the second half is
      // the one that makes the import visible.
      expect(patch.data.occurrence.textmap.content[0]).toMatchObject({
        type: "moduleEmbed", attrs: { occurrenceId: "root-1" },
      });
    });

    it("keeps the parent module's other meta when it flips allowChildContainers", () => {
      const { emitted } = run();
      const modPatch = emitted.find(
        (e) => e.event === "update_module" && e.data.module?.meta?.allowChildContainers,
      );
      expect(modPatch?.data.module.meta.cover).toBe("keep-me");
    });

    it("mints NOTHING when the import fails", () => {
      const emitted = [];
      const socket = {
        connected: true,
        emit: vi.fn((event, data) => emitted.push({ event, data })),
        on: vi.fn(), off: vi.fn(),
      };
      applyIntakeShape(INTAKE_SHAPES.TEXT_DOC_PAGE.id, {
        payload: { kind: "text", text: "a paragraph long enough to import" },
        destination: { parentId: "c1" },
        destinationOccurrence: { id: "c1", moduleId: "cm", occurrences: [] },
        destinationModule: { id: "cm", meta: {} },
        gridId: "g1", userId: "u1", dispatch: vi.fn(), socket,
      });
      const ack = socket.on.mock.calls.find(([ev]) => ev === "import_text_result")?.[1];
      ack?.({ ok: false, error: "boom" });
      expect(emitted.some((e) => e.event === "create_module")).toBe(false);
    });

    // The empty-cell drop mints a panel seconds before this runs and only the
    // drop handler knows about it — so that case stays the caller's.
    it("hands a HOMELESS import back to the caller's seam", () => {
      const socket = { connected: true, emit: vi.fn(), on: vi.fn(), off: vi.fn() };
      const onImportText = vi.fn();
      applyIntakeShape(INTAKE_SHAPES.TEXT_DOC_PAGE.id, {
        payload: { kind: "text", text: "a paragraph long enough to import" },
        destination: { parentId: null }, destinationOccurrence: null,
        gridId: "g1", userId: "u1", dispatch: vi.fn(), socket, onImportText,
      });
      expect(onImportText).toHaveBeenCalledTimes(1);
      expect(socket.emit).not.toHaveBeenCalled();
    });
  });

  // The picture is evidence — reading it must not consume it. And the text is
  // kept WHOLE here; splitting it per line is the other shape.
  describe("the file-OCR shape keeps the picture AND adds its text", () => {
    function ocrCtx(emitted) {
      const socket = {
        connected: true,
        emit: vi.fn((event, data) => emitted.push({ event, data })),
        on: vi.fn(), off: vi.fn(),
      };
      const done = {};
      done.promise = new Promise((r) => { done.resolve = r; });
      return {
        // A REAL File: the route calls `URL.createObjectURL`, which rejects a
        // plain `{name,type}` stub. (My first fixture was one, and the throw
        // read exactly like a broken route.)
        files: [new File(["photo-bytes"], "receipt.jpg", { type: "image/jpeg" })],
        gridId: "g1", userId: "u1", dispatch: vi.fn(), socket,
        destinationOccurrence: { id: "c1", moduleId: "cm", occurrences: [] },
        onIntakeResult: (r) => done.resolve(r),
        _done: done.promise,
      };
    }

    it("uploads the image and mints ONE textblock holding the prose", async () => {
      // The SINGLE newline is the discriminator: OCR wraps long lines, so a
      // lone newline is a wrapped line, not a new paragraph. The checklist
      // shape would make three items out of this; prose makes two paragraphs.
      runOcr.mockResolvedValueOnce("Whole Foods\nMarket St\n\nTotal 42.10");
      const emitted = [];
      const ctx = ocrCtx(emitted);
      applyIntakeShape(INTAKE_SHAPES.FILE_OCR_TEXT.id, ctx);
      const res = await ctx._done;

      expect(createArtifactPlaceholders, "the photo was not kept").toHaveBeenCalledTimes(1);
      expect(uploadArtifactPlaceholders).toHaveBeenCalledTimes(1);
      expect(res.ok).toBe(true);

      const blocks = emitted.filter(
        (e) => e.event === "create_occurrence" && e.data.occurrence?.textmap,
      );
      expect(blocks, "expected exactly one textblock").toHaveLength(1);
      // Two paragraphs, split on the BLANK line only — not one per newline,
      // which is what the checklist shape does and what this one must not.
      const paras = blocks[0].data.occurrence.textmap.content;
      expect(paras).toHaveLength(2);
      expect(paras[0].content[0].text).toBe("Whole Foods\nMarket St");
      expect(paras[1].content[0].text).toBe("Total 42.10");
    });

    it("reports unreadable text WITHOUT claiming the upload failed", async () => {
      runOcr.mockResolvedValueOnce("   ");
      const emitted = [];
      const ctx = ocrCtx(emitted);
      applyIntakeShape(INTAKE_SHAPES.FILE_OCR_TEXT.id, ctx);
      const res = await ctx._done;

      expect(res.ok).toBe(false);
      // The artifact DID land — a blanket "failed" would be a lie about it.
      expect(createArtifactPlaceholders).toHaveBeenCalledTimes(1);
      expect(res.error).toMatch(/still added/i);
      expect(emitted.some((e) => e.event === "create_occurrence" && e.data.occurrence?.textmap)).toBe(false);
    });

    it("surfaces an OCR failure instead of swallowing it", async () => {
      runOcr.mockRejectedValueOnce(new Error("worker died"));
      const emitted = [];
      const ctx = ocrCtx(emitted);
      applyIntakeShape(INTAKE_SHAPES.FILE_OCR_TEXT.id, ctx);
      const res = await ctx._done;
      expect(res).toMatchObject({ ok: false });
      expect(res.error).toMatch(/worker died/);
    });
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

// ── Task 5 ★: the file-CONTENT shapes ───────────────────────────────────────
//
// These are the only routes that read the dropped file, which makes them the
// only asynchronous ones. What is worth pinning here is not the conversion
// (csvToTable owns that, with its own tests) but the three things the ROUTER is
// responsible for: it emits with the right format and parent, it names the root
// after the FILE, and it reports every failure instead of going quiet.
describe("file-content shapes (.md / .csv)", () => {
  const fileOf = (name, text) => ({ name, text: () => Promise.resolve(text) });
  const socketOf = () => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() });

  it("a .md file is imported as markdown, rooted at the destination", async () => {
    const socket = socketOf();
    await applyIntakeShape(INTAKE_SHAPES.FILE_MARKDOWN_IMPORT.id, {
      files: [fileOf("Weekly plan.md", "# Heading\n\nSome prose.")],
      gridId: "g1", socket, destinationOccurrence: { id: "cont-9" },
    }).run;
    await Promise.resolve(); await Promise.resolve();
    expect(socket.emit).toHaveBeenCalledTimes(1);
    const [event, body] = socket.emit.mock.calls[0];
    expect(event).toBe("import_text");
    expect(body).toMatchObject({ gridId: "g1", format: "markdown", parentId: "cont-9" });
    expect(body.content).toContain("# Heading");
    // The root is named after the FILE, not after its first heading — otherwise
    // a dropped file arrives under a name that has nothing to do with it.
    expect(body.title).toBe("Weekly plan");
  });

  it("a .csv file is converted to a pipe table before it is sent", async () => {
    const socket = socketOf();
    applyIntakeShape(INTAKE_SHAPES.FILE_CSV_TABLE.id, {
      files: [fileOf("rows.csv", "name,qty\nApples,3")],
      gridId: "g1", socket, destination: { parentId: "p1" },
    });
    await Promise.resolve(); await Promise.resolve();
    const [, body] = socket.emit.mock.calls[0];
    // markdown, not "csv" — the server has no CSV path; buildTable reads a pipe
    // table, and that is deliberately the whole conversion (see csvToTable.js).
    expect(body.format).toBe("markdown");
    expect(body.content).toBe("| name | qty |\n| --- | --- |\n| Apples | 3 |");
  });

  it("a one-column CSV FAILS OUT LOUD instead of importing as prose", async () => {
    const socket = socketOf();
    const onImportResult = vi.fn();
    applyIntakeShape(INTAKE_SHAPES.FILE_CSV_TABLE.id, {
      files: [fileOf("list.csv", "just\none\ntwo")],
      gridId: "g1", socket, onImportResult,
    });
    await Promise.resolve(); await Promise.resolve();
    expect(socket.emit).not.toHaveBeenCalled();
    expect(onImportResult).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: expect.stringContaining("at least 2") }),
    );
  });

  it("an empty .md writes nothing and reports it", async () => {
    const socket = socketOf();
    const onImportResult = vi.fn();
    applyIntakeShape(INTAKE_SHAPES.FILE_MARKDOWN_IMPORT.id, {
      files: [fileOf("blank.md", "   \n\n")], gridId: "g1", socket, onImportResult,
    });
    await Promise.resolve(); await Promise.resolve();
    expect(socket.emit).not.toHaveBeenCalled();
    expect(onImportResult).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it("an unreadable file reports rather than throwing into the drop handler", async () => {
    const socket = socketOf();
    const onImportResult = vi.fn();
    applyIntakeShape(INTAKE_SHAPES.FILE_MARKDOWN_IMPORT.id, {
      files: [{ name: "x.md", text: () => Promise.reject(new Error("boom")) }],
      gridId: "g1", socket, onImportResult,
    });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(socket.emit).not.toHaveBeenCalled();
    expect(onImportResult).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: expect.stringContaining("x.md") }),
    );
  });

  it("both shapes are now OFFERED — the sheet no longer hides them", () => {
    // The classifier has always emitted these; until the router carried them,
    // filterToImplemented stripped them back out.
    const md = filterToImplemented(classifyIntake({ files: [{ name: "notes.md" }] }, {}));
    expect(md.shapes.map((s) => s.id)).toContain(INTAKE_SHAPES.FILE_MARKDOWN_IMPORT.id);
    expect(md.preselected).toBe(INTAKE_SHAPES.FILE_MARKDOWN_IMPORT.id);
    const csv = filterToImplemented(classifyIntake({ files: [{ name: "rows.csv" }] }, {}));
    expect(csv.shapes.map((s) => s.id)).toContain(INTAKE_SHAPES.FILE_CSV_TABLE.id);
  });
});

// ── Task 5: the link chip ───────────────────────────────────────────────────
//
// The audit's headline finding was that a dropped link became a card labelled
// with the raw URL. What matters here is not that SOMETHING is minted, but that
// what's minted is the SAME thing an imported page's prose links are — carrying
// `meta.link`, so Task 6's relink can find it and the two can never diverge.
describe("the link-chip shape", () => {
  const mkCtx = (over = {}) => ({
    payload: { kind: "link", urls: ["https://en.wikipedia.org/wiki/The_Eminem_Show"] },
    destinationOccurrence: { id: "cont-1", gridId: "g1" },
    gridId: "g1", userId: "u1", dispatch: vi.fn(), socket: { emit: vi.fn() },
    ...over,
  });

  it("mints a textblock carrying meta.link, not a card labelled with the URL", () => {
    const ctx = mkCtx();
    applyIntakeShape(INTAKE_SHAPES.LINK_CHIP.id, ctx);
    const mods = ctx.dispatch.mock.calls
      .map(([a]) => a?.payload?.module).filter(Boolean);
    expect(mods.length).toBeGreaterThan(0);
    const mod = mods.find((m) => m.role === "textblock");
    expect(mod.meta).toEqual({ link: { kind: "url", url: "https://en.wikipedia.org/wiki/The_Eminem_Show" } });
    expect(mod.label).toBe("The Eminem Show");
  });

  it("mints one chip PER url — a block of links is one payload, not one link", () => {
    const ctx = mkCtx({ payload: { kind: "link", urls: ["https://a.com/one", "https://b.com/two"] } });
    applyIntakeShape(INTAKE_SHAPES.LINK_CHIP.id, ctx);
    const mods = ctx.dispatch.mock.calls
      .map(([a]) => a?.payload?.module).filter((m) => m?.role === "textblock");
    expect(mods.map((m) => m.label)).toEqual(["one", "two"]);
  });

  it("writes NOTHING when there is no destination to write into", () => {
    const ctx = mkCtx({ destinationOccurrence: null });
    applyIntakeShape(INTAKE_SHAPES.LINK_CHIP.id, ctx);
    expect(ctx.dispatch).not.toHaveBeenCalled();
  });

  it("hands what it minted back so a doc can embed it", () => {
    const onLinkChips = vi.fn();
    applyIntakeShape(INTAKE_SHAPES.LINK_CHIP.id, mkCtx({ onLinkChips }));
    expect(onLinkChips).toHaveBeenCalledWith([expect.objectContaining({ occurrenceId: expect.any(String) })]);
  });
});

// Several links dropped together: ONE container of chips, not N loose rows.
describe("the link-container shape", () => {
  const ctx = () => ({
    payload: { kind: "link", urls: ["https://a.com/one", "https://b.com/two"] },
    destinationOccurrence: { id: "cont-1", gridId: "g1" },
    gridId: "g1", userId: "u1", dispatch: vi.fn(), socket: { emit: vi.fn() },
  });

  it("mints ONE container and puts every chip inside it", () => {
    const c = ctx();
    applyIntakeShape(INTAKE_SHAPES.LINK_CONTAINER.id, c);
    const mods = c.dispatch.mock.calls.map(([a]) => a?.payload?.module).filter(Boolean);
    const containers = mods.filter((m) => m.role === "container");
    const chips = mods.filter((m) => m.role === "textblock");
    expect(containers).toHaveLength(1);
    expect(chips.map((m) => m.label)).toEqual(["one", "two"]);
    // and the chips carry the link, same as a lone chip drop
    expect(chips[0].meta.link).toEqual({ kind: "url", url: "https://a.com/one" });
  });

  it("names the container by how many links it holds", () => {
    const c = ctx();
    applyIntakeShape(INTAKE_SHAPES.LINK_CONTAINER.id, c);
    const cont = c.dispatch.mock.calls.map(([a]) => a?.payload?.module).find((m) => m?.role === "container");
    expect(cont.label).toBe("2 links");
  });

  it("writes NOTHING with no destination", () => {
    const c = ctx();
    c.destinationOccurrence = null;
    applyIntakeShape(INTAKE_SHAPES.LINK_CONTAINER.id, c);
    expect(c.dispatch).not.toHaveBeenCalled();
  });
});
