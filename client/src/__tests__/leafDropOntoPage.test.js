// A LEAF DROPPED ON A BOARD PAGE LANDS ON THE PAGE.
//
// USER, 2026-09-23: *"its the hover highlight for dropping stuff"* → *"i meant
// the hover line on where it can drop"* → *"anything can land page level"*.
//
// Measured on prod before writing this: dragging the row "Email Sam" into the
// space BETWEEN two containers on a board page drew NO indicator and, on
// release, changed nothing at all —
//
//     BEFORE: Today[Email Sam]  This Week[Book dentist, ui-test-square.png]
//     AFTER : Today[Email Sam]  This Week[Book dentist, ui-test-square.png]
//     VERDICT: the drop did NOTHING
//
// The page ALREADY accepts these types — `DropAccepts.PAGE_CONTENT` lists
// INSTANCE, MODULE, ARTIFACT, FOLDER, EXTERNAL, FILE, TEXT and URL — so the
// drop zone was live and the drop was routed. What was missing is the
// destination: `handleOccurrenceMove`'s page branch is gated on
// `toPageMod?.kind === "canvas"`, so a BOARD page fell past it into the
// container path, resolved no container, and returned having written nothing.
//
// A board page differs from a canvas page in exactly two ways, and the branch
// is widened rather than copied (two implementations of one question is this
// codebase's most-repeated defect class):
//
//     canvas   position is meta.x/y from the pointer   order is meaningless, append
//     board    no meta stamp                           ORDER is the placement, insert at index
//
// The index comes from `position.insertIndex` — the same number the insertion
// LINE is drawn from — so the cue and the landing cannot disagree.
import { describe, it, expect, vi, beforeEach } from "vitest";

const updates = [];
const creates = [];
vi.mock("../helpers/CommitHelpers", () => ({
  updateOccurrence: (a) => { updates.push(a.occurrence); },
  createOccurrence: (a) => { creates.push(a.occurrence); },
  createModule: vi.fn(), removeOccurrence: vi.fn(), updateModule: vi.fn(),
}));
vi.mock("../helpers/LayoutHelpers", () => ({
  moveContainerBetweenPanels: vi.fn(), reorderContainersInPanel: vi.fn(),
  copyContainerToPanel: vi.fn(), createContainerInPanel: vi.fn(),
  createPanelInGrid: vi.fn(), copyInstanceToContainer: vi.fn(),
  findOccurrenceIdByTarget: (moduleId, ids, occs) =>
    (ids || []).find(id => occs[id]?.moduleId === moduleId) || null,
  getTargetIndexInOccurrences: (moduleId, ids, occs) =>
    (ids || []).findIndex(id => occs[id]?.moduleId === moduleId),
}));

const { handleOccurrenceMove } = await import("../helpers/dropHandlers");

// A board page holding two containers; the row lives in the first.
const PAGE = { id: "page", moduleId: "m-page", occurrences: ["today", "week"] };
const TODAY = { id: "today", moduleId: "m-today", occurrences: ["row"] };
const WEEK = { id: "week", moduleId: "m-week", occurrences: [] };
const ROW = { id: "row", moduleId: "m-row", parentId: "today", fields: {}, meta: {} };
const CANVAS = { id: "cpage", moduleId: "m-canvas", occurrences: [] };

const occurrencesById = { page: PAGE, today: TODAY, week: WEEK, row: ROW, cpage: CANVAS };
const modulesById = {
  "m-page":   { id: "m-page",   role: "page",      kind: "board",  label: "Tasks" },
  "m-canvas": { id: "m-canvas", role: "page",      kind: "canvas", label: "Board" },
  "m-today":  { id: "m-today",  role: "container", kind: "board",  label: "Today" },
  "m-week":   { id: "m-week",   role: "container", kind: "board",  label: "This Week" },
  "m-row":    { id: "m-row",    role: "instance",  kind: "list",   label: "Email Sam" },
};

function ctx(mode = "move") {
  return {
    dispatch: vi.fn(), socket: {},
    state: { modulesById, gridId: "g1", userId: "u1", grid: {}, modules: Object.values(modulesById) },
    occurrencesById,
    baseContainers: [],
    baseAllPanels: [],
    clearSession: vi.fn(),
    sessionRef: { current: { mode } },
  };
}

// Dropped on the page itself — no container under the pointer.
function dropOnPage(insertIndex, mode = "move", pageId = "page") {
  return {
    payload: { moduleId: "m-row", occurrenceId: "row",
               context: { panelId: "panelA", occurrenceId: "row", pageOccurrenceId: "today" } },
    target: { kind: "page-content", moduleId: modulesById[occurrencesById[pageId].moduleId].id,
              occurrenceId: pageId, raw: { pageOccurrenceId: pageId, panelId: "panelA" } },
    position: { edge: null, insertIndex },
    pointer: { x: 10, y: 10 }, mode, modifiers: {},
  };
}

beforeEach(() => { updates.length = 0; creates.length = 0; });

const pageList = () => updates.filter(u => u.id === "page").slice(-1)[0]?.occurrences;

describe("a row dropped on a board page", () => {
  it("becomes a child of the PAGE instead of doing nothing", () => {
    handleOccurrenceMove(dropOnPage(1), ctx());
    const reparent = updates.find(u => u.id === "row" && u.parentId);
    expect(reparent?.parentId).toBe("page");
  });

  it("lands at the index the insertion line showed", () => {
    handleOccurrenceMove(dropOnPage(1), ctx());
    // between the two containers
    expect(pageList()).toEqual(["today", "row", "week"]);
  });

  it("lands BEFORE the first container when that is where the line was", () => {
    handleOccurrenceMove(dropOnPage(0), ctx());
    expect(pageList()).toEqual(["row", "today", "week"]);
  });

  it("lands AFTER the last container", () => {
    handleOccurrenceMove(dropOnPage(2), ctx());
    expect(pageList()).toEqual(["today", "week", "row"]);
  });

  it("is taken OUT of the container it came from", () => {
    handleOccurrenceMove(dropOnPage(1), ctx());
    const from = updates.filter(u => u.id === "today").slice(-1)[0];
    expect(from?.occurrences).toEqual([]);
  });

  it("does NOT stamp canvas coordinates on it", () => {
    // meta.x/y is how a CANVAS page places a card. A board page orders its
    // children in a list; writing x/y there would be dead data that a later
    // canvas render would honour.
    handleOccurrenceMove(dropOnPage(1), ctx());
    const reparent = updates.find(u => u.id === "row" && u.parentId);
    expect(reparent?.meta?.x).toBeUndefined();
    expect(reparent?.meta?.y).toBeUndefined();
  });

  it("appends when the drop carries no index", () => {
    handleOccurrenceMove(dropOnPage(undefined), ctx());
    expect(pageList()).toEqual(["today", "week", "row"]);
  });
});

describe("copy mode", () => {
  it("mints a NEW occurrence on the page and leaves the original alone", () => {
    handleOccurrenceMove(dropOnPage(1, "copy"), ctx("copy"));
    expect(creates.length).toBe(1);
    expect(creates[0].parentId).toBe("page");
    expect(creates[0].moduleId).toBe("m-row");
    // the source container is untouched
    expect(updates.find(u => u.id === "today")).toBeUndefined();
  });

  it("puts the copy at the line's index too", () => {
    handleOccurrenceMove(dropOnPage(0, "copy"), ctx("copy"));
    expect(pageList()).toEqual([creates[0].id, "today", "week"]);
  });
});

describe("controls — what must NOT change", () => {
  it("a CANVAS page still stamps meta.x/y (the branch it was written for)", () => {
    const drop = dropOnPage(undefined, "move", "cpage");
    handleOccurrenceMove(drop, ctx());
    const reparent = updates.find(u => u.id === "row" && u.parentId === "cpage");
    expect(reparent).toBeTruthy();
    expect(typeof reparent.meta?.x).toBe("number");
    expect(typeof reparent.meta?.y).toBe("number");
  });

  it("a row already on the page REORDERS rather than re-parenting", () => {
    const c = ctx();
    c.occurrencesById = {
      ...occurrencesById,
      page: { id: "page", moduleId: "m-page", occurrences: ["today", "row", "week"] },
      row: { id: "row", moduleId: "m-row", parentId: "page", fields: {}, meta: {} },
    };
    handleOccurrenceMove(dropOnPage(0), c);
    expect(pageList()).toEqual(["row", "today", "week"]);
  });

  it("a drop with no resolvable occurrence writes nothing", () => {
    const drop = dropOnPage(1);
    drop.payload = { moduleId: "m-nothing", context: { panelId: "panelA", pageOccurrenceId: "page" } };
    handleOccurrenceMove(drop, ctx());
    expect(updates).toEqual([]);
    expect(creates).toEqual([]);
  });
});

// A SAME-PAGE REORDER COUNTS POSITIONS IN THE LIST THE USER SEES.
//
// `insertAt` is an index into the list that still CONTAINS the dragged row —
// it is the position the insertion line was drawn at. The row is removed before
// being re-inserted, so an index after its old position must come down by one.
// Measured on prod: page [Email Sam, Today, This Week], line drawn between
// Today and This Week (insertAt 2), row landed LAST.
describe("reordering a row that is already on the page", () => {
  function onPage(order, insertIndex) {
    const c = ctx();
    c.occurrencesById = {
      ...occurrencesById,
      page: { id: "page", moduleId: "m-page", occurrences: order },
      row: { id: "row", moduleId: "m-row", parentId: "page", fields: {}, meta: {} },
    };
    handleOccurrenceMove(dropOnPage(insertIndex), c);
    return updates.filter(u => u.id === "page").slice(-1)[0]?.occurrences;
  }

  it("moves DOWN to the middle — the prod case", () => {
    // line between today and week; in [row,today,week] that is index 2
    expect(onPage(["row", "today", "week"], 2)).toEqual(["today", "row", "week"]);
  });

  it("moves DOWN to the end", () => {
    expect(onPage(["row", "today", "week"], 3)).toEqual(["today", "week", "row"]);
  });

  it("moves UP to the front (no shift — the control)", () => {
    // the row starts AFTER the target, so nothing shifts
    expect(onPage(["today", "week", "row"], 0)).toEqual(["row", "today", "week"]);
  });

  it("moves UP to the middle (control)", () => {
    expect(onPage(["today", "week", "row"], 1)).toEqual(["today", "row", "week"]);
  });

  it("a CROSS-parent drop is not shifted (the row was not in the list)", () => {
    // this is the ordinary case: the row comes from a container
    handleOccurrenceMove(dropOnPage(1), ctx());
    expect(pageList()).toEqual(["today", "row", "week"]);
  });
});
