// __tests__/linkFollow.test.js
//
// `link-follow` — the last of the 24 intake shapes. One hop, any domain, and
// NOTHING imported until the user has ticked a list and confirmed.
//
// The tests are weighted to the REFUSALS and to the confirm gate, because every
// failure mode here writes: importing pages nobody approved, filing them where
// they cannot be found, or reporting success over a partial run.
import { describe, it, expect, vi, beforeEach } from "vitest";

const harvestLinks = vi.fn();
const convertLinkToPage = vi.fn();
const openConfirmList = vi.fn();
const createFolder = vi.fn();
const spliceChildIntoParent = vi.fn();
const ensureImportsFolderAndPage = vi.fn(() => ({ folderId: "imports-1" }));
const ensureFolderPageOcc = vi.fn(() => "page-occ-1");

vi.mock("../helpers/linkToPage", () => ({ harvestLinks, convertLinkToPage }));
vi.mock("../ui/ConfirmListHost", () => ({ openConfirmList }));
vi.mock("../helpers/importsFolder", () => ({ ensureImportsFolderAndPage, ensureFolderPageOcc }));

// The router imports CommitHelpers both by name and as a namespace; the mock has
// to satisfy every binding it touches or the module fails to load.
vi.mock("../helpers/CommitHelpers", () => ({
  createFolder,
  spliceChildIntoParent,
  createTextblockInContainer: vi.fn(),
  createContainerInContainer: vi.fn(),
  createLeafInstanceInParent: vi.fn(),
  createPageInContainer: vi.fn(),
  updateOccurrence: vi.fn(),
  createModule: vi.fn(),
  createOccurrence: vi.fn(),
}));

const toastCalls = [];
vi.mock("../state/notificationStore", () => ({
  toast: {
    loading: (label) => { toastCalls.push(["loading", label]); return "tok-1"; },
    success: (label) => { toastCalls.push(["success", label]); },
    error: (label) => { toastCalls.push(["error", label]); },
    dismiss: (id) => { toastCalls.push(["dismiss", id]); },
  },
}));

const { applyIntakeShape, describeLinkSet } = await import("../helpers/intakeApply.js");
const { INTAKE_SHAPES } = await import("../helpers/intake.js");

const SHAPE = INTAKE_SHAPES.LINK_FOLLOW.id;

const baseCtx = (over = {}) => ({
  payload: { kind: "link", urls: ["https://example.com/hub"] },
  gridId: "g1",
  userId: "u1",
  dispatch: vi.fn(),
  socket: { connected: true, emit: vi.fn(), on: vi.fn(), off: vi.fn() },
  destinationOccurrence: { id: "dest-1", occurrences: [] },
  grid: { _id: "g1", manifestId: "m1" },
  manifests: [{ id: "m1", rootFolderId: "root-1" }],
  folders: [{ id: "root-1", name: "Root" }],
  occurrencesById: {},
  ...over,
});

/** Run the route, then run whatever the confirm list would have confirmed. */
async function runAndConfirm(ctx, urls = null) {
  await applyIntakeShape(SHAPE, ctx);
  const req = openConfirmList.mock.calls.at(-1)?.[0];
  const picked = urls || req.items.map((i) => i.id);
  await req.onConfirm(picked);
  return req;
}

beforeEach(() => {
  vi.clearAllMocks();
  toastCalls.length = 0;
  openConfirmList.mockReturnValue(true);
  convertLinkToPage.mockResolvedValue({ ok: true, rootOccurrenceId: "r1" });
  harvestLinks.mockResolvedValue({
    ok: true,
    url: "https://example.com/hub",
    total: 2,
    truncated: false,
    links: [
      { url: "https://example.com/a", label: "Page A" },
      { url: "https://other.example/b", label: "Page B" },
    ],
  });
});

describe("link-follow: the ask", () => {
  it("crawls the dropped link and offers its links for approval", async () => {
    await applyIntakeShape(SHAPE, baseCtx());
    expect(harvestLinks).toHaveBeenCalledWith(expect.objectContaining({ url: "https://example.com/hub" }));
    const req = openConfirmList.mock.calls[0][0];
    expect(req.items.map((i) => i.id)).toEqual([
      "https://example.com/a", "https://other.example/b",
    ]);
    // Nothing imported yet — the confirmation IS the feature.
    expect(convertLinkToPage).not.toHaveBeenCalled();
    expect(createFolder).not.toHaveBeenCalled();
  });

  it("REFUSES when there is no confirm surface — never imports them all instead", async () => {
    openConfirmList.mockReturnValue(false);
    await applyIntakeShape(SHAPE, baseCtx());
    expect(convertLinkToPage).not.toHaveBeenCalled();
    expect(createFolder).not.toHaveBeenCalled();
    expect(toastCalls.some(([k, m]) => k === "error" && /nothing was imported/i.test(m))).toBe(true);
  });

  it("fails CLOSED without the folder tree, and says which half is missing", async () => {
    await applyIntakeShape(SHAPE, baseCtx({ grid: null }));
    expect(harvestLinks).not.toHaveBeenCalled();
    expect(toastCalls.some(([k, m]) => k === "error" && /folder tree/i.test(m))).toBe(true);
  });

  it("passes the crawl's own reason through when the page cannot be read", async () => {
    harvestLinks.mockResolvedValue({ ok: false, error: "not a web page (content-type: application/pdf)" });
    await applyIntakeShape(SHAPE, baseCtx());
    expect(openConfirmList).not.toHaveBeenCalled();
    expect(toastCalls.some(([k, m]) => k === "error" && /not a web page/.test(m))).toBe(true);
  });

  it("says so rather than minting an empty folder when the page links nowhere", async () => {
    harvestLinks.mockResolvedValue({ ok: true, url: "https://example.com/hub", links: [], total: 0 });
    await applyIntakeShape(SHAPE, baseCtx());
    expect(openConfirmList).not.toHaveBeenCalled();
    expect(createFolder).not.toHaveBeenCalled();
    expect(toastCalls.some(([k, m]) => k === "error" && /links to nothing/i.test(m))).toBe(true);
  });

  it("reports the cap in the subtitle instead of showing a short list silently", async () => {
    harvestLinks.mockResolvedValue({
      ok: true, url: "https://example.com/hub", truncated: true, total: 240,
      links: [{ url: "https://example.com/a", label: "A" }],
    });
    await applyIntakeShape(SHAPE, baseCtx());
    expect(openConfirmList.mock.calls[0][0].subtitle).toMatch(/1 of 240/);
  });
});

describe("link-follow: the import", () => {
  it("imports ONLY the ticked pages, into one new folder under Imports", async () => {
    await runAndConfirm(baseCtx(), ["https://example.com/a"]);

    expect(createFolder).toHaveBeenCalledTimes(1);
    const folder = createFolder.mock.calls[0][0].folder;
    expect(folder.parentId).toBe("imports-1");

    expect(convertLinkToPage).toHaveBeenCalledTimes(1);
    expect(convertLinkToPage.mock.calls[0][0]).toMatchObject({
      url: "https://example.com/a",
      // Homed in the folder: a folder page renders what is PARENTED to it, so
      // importing anywhere else leaves the page empty.
      parentId: folder.id,
    });
  });

  it("imports SEQUENTIALLY — one fetch at a time, not a parallel volley", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    convertLinkToPage.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { ok: true };
    });
    await runAndConfirm(baseCtx());
    expect(convertLinkToPage).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1);
  });

  it("places the folder page where the drop happened, while it lives in the folder", async () => {
    await runAndConfirm(baseCtx());
    expect(ensureFolderPageOcc).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: createFolder.mock.calls[0][0].folder.id }),
    );
    expect(spliceChildIntoParent).toHaveBeenCalledWith(
      expect.objectContaining({ occurrenceId: "page-occ-1" }),
    );
  });

  it("does not splice anywhere when the drop had no destination", async () => {
    await runAndConfirm(baseCtx({ destinationOccurrence: null }));
    expect(spliceChildIntoParent).not.toHaveBeenCalled();
    expect(convertLinkToPage).toHaveBeenCalledTimes(2);   // the import still runs
  });

  it("reports a PARTIAL run as partial rather than as success", async () => {
    convertLinkToPage
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: "timed out" });
    await runAndConfirm(baseCtx());
    const [kind, msg] = toastCalls.at(-1);
    expect(kind).toBe("success");
    expect(msg).toMatch(/Imported 1 page/);
    expect(msg).toMatch(/1 could not be read/);
  });

  it("reports a total failure as a failure, not as 'imported 0'", async () => {
    convertLinkToPage.mockResolvedValue({ ok: false, error: "timed out" });
    await runAndConfirm(baseCtx());
    const [kind, msg] = toastCalls.at(-1);
    expect(kind).toBe("error");
    expect(msg).toMatch(/None of the 2 pages/);
  });

  it("hands the outcome to onIntakeResult when the caller owns reporting", async () => {
    const onIntakeResult = vi.fn();
    await runAndConfirm(baseCtx({ onIntakeResult }));
    expect(onIntakeResult).toHaveBeenCalledWith(expect.objectContaining({ ok: true, count: 2 }));
  });
});

describe("describeLinkSet", () => {
  it("names the folder after the source host, the count and the day", () => {
    expect(describeLinkSet("https://en.wikipedia.org/wiki/X", 6, new Date(2026, 7, 9)))
      .toBe("en.wikipedia.org — 6 pages (2026-08-09)");
  });

  it("singularises one page and survives a junk url", () => {
    expect(describeLinkSet("https://a.example/x", 1, new Date(2026, 0, 2)))
      .toBe("a.example — 1 page (2026-01-02)");
    expect(describeLinkSet("not a url", 2, new Date(2026, 0, 2))).toMatch(/^not a url — 2 pages/);
  });
});
