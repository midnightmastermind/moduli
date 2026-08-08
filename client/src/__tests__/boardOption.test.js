// Intake Task 5 — the board-option shape, which the plan calls the one worth
// fighting for: dropping a film link on the Movies board should produce a MOVIE
// every Media dropdown can see, not a card that is invisible to the system.
//
// FIXTURES ARE THE REAL SHAPE, measured on poms grid 2026-08-07 (37 occurrences
// carry a feed and every option board matches this):
//   feed:       { enabled: true, conditions: [{ fieldId, comparator: "CONTAINS", value: "ingredient" }] }
//   own fields: { <same fieldId>: { value: ["ingredient"], flow: "in" } }

import { describe, it, expect } from "vitest";
import { optionBoardStampFields, isOptionBoard } from "../helpers/boardOption.js";

const TAG = "uew6sn6WWXin"; // the real Board Category field id on poms grid

const board = (over = {}) => ({
  id: "b1",
  feed: { enabled: true, conditions: [{ fieldId: TAG, comparator: "CONTAINS", value: "ingredient" }], roles: ["instance"] },
  fields: { [TAG]: { value: ["ingredient"], flow: "in" } },
  ...over,
});

describe("optionBoardStampFields", () => {
  it("stamps the board's OWN value, not the condition's", () => {
    // The condition holds the scalar "ingredient"; the board holds
    // ["ingredient"]. Every seeded option carries the ARRAY, so a minted option
    // must too — copying the scalar makes a value of a different shape that the
    // feed's CONTAINS still matches, which works until something reads the field
    // expecting an array.
    const got = optionBoardStampFields(board());
    expect(got).toEqual({ [TAG]: { value: ["ingredient"], flow: "in" } });
  });

  it("carries every condition field the board actually holds", () => {
    const two = board({
      feed: {
        enabled: true,
        conditions: [{ fieldId: TAG, value: "movie" }, { fieldId: "f2", value: "x" }],
      },
      fields: { [TAG]: { value: ["movie"] }, f2: { value: "x" } },
    });
    expect(Object.keys(optionBoardStampFields(two))).toEqual([TAG, "f2"]);
  });
});

describe("optionBoardStampFields — the refusals, which are the whole safety of it", () => {
  it("is null when the feed is disabled", () => {
    expect(optionBoardStampFields(board({ feed: { enabled: false, conditions: [{ fieldId: TAG }] } }))).toBeNull();
  });

  it("is null for a container with no feed at all — an ordinary board", () => {
    expect(optionBoardStampFields({ id: "plain", fields: { [TAG]: { value: ["x"] } } })).toBeNull();
  });

  it("REFUSES a feed whose field the board does not carry itself", () => {
    // The discriminating case. A feed filtering on something the board does not
    // hold describes a VIEW, not an identity — minting into it would produce a
    // row the feed cannot see, which is exactly the invisible-option failure
    // this helper exists to prevent.
    const viewOnly = board({ fields: {} });
    expect(optionBoardStampFields(viewOnly)).toBeNull();
  });

  it("treats an empty value or empty array as not carried", () => {
    expect(optionBoardStampFields(board({ fields: { [TAG]: { value: [] } } }))).toBeNull();
    expect(optionBoardStampFields(board({ fields: { [TAG]: { value: "" } } }))).toBeNull();
  });

  it("is null for a feed with no conditions", () => {
    expect(optionBoardStampFields(board({ feed: { enabled: true, conditions: [] } }))).toBeNull();
  });

  it("survives null and junk without throwing", () => {
    expect(optionBoardStampFields(null)).toBeNull();
    expect(optionBoardStampFields({})).toBeNull();
    expect(optionBoardStampFields({ feed: { enabled: true, conditions: [{}] }, fields: {} })).toBeNull();
  });
});

describe("isOptionBoard", () => {
  it("is the truthiness of the stamp, so an ordinary board is false", () => {
    expect(isOptionBoard(board())).toBe(true);
    expect(isOptionBoard({ id: "plain" })).toBe(false);
  });
});

// ── The route, end to end ──────────────────────────────────────────────────
import { applyIntakeShape, assertShapeCoverage } from "../helpers/intakeApply.js";
import { INTAKE_SHAPES } from "../helpers/intake.js";

describe("LINK_BOARD_OPTION route", () => {
  it("is registered, so the sheet can offer it", () => {
    expect(assertShapeCoverage().implemented).toContain(INTAKE_SHAPES.LINK_BOARD_OPTION.id);
  });

  it("mints an option carrying the board's tag, bound HIDDEN", () => {
    const emitted = [];
    const socket = { connected: true, emit: (ev, data) => emitted.push({ ev, data }) };
    const res = applyIntakeShape(INTAKE_SHAPES.LINK_BOARD_OPTION.id, {
      payload: { urls: ["https://en.wikipedia.org/wiki/Inception"] },
      destinationOccurrence: board(),
      gridId: "g1", userId: "u1", dispatch: () => {}, socket,
    });
    expect(res.ok).toBe(true);

    const madeOcc = emitted.find(e => e.ev === "create_occurrence");
    const madeMod = emitted.find(e => e.ev === "create_module");
    expect(madeOcc).toBeTruthy();
    // The identity tag is what makes it visible to every dropdown on this board.
    expect(madeOcc.data.occurrence.fields[TAG].value).toEqual(["ingredient"]);
    // Hidden: the tag is how the option is FOUND, never something to read on it.
    const binding = madeMod.data.module.fieldBindings.find(b => b.fieldId === TAG);
    expect(binding.hidden).toBe(true);
  });

  it("REFUSES and reports on a board that does not define its options", () => {
    // Silently doing nothing here is indistinguishable from "the drop failed".
    const seen = [];
    const res = applyIntakeShape(INTAKE_SHAPES.LINK_BOARD_OPTION.id, {
      payload: { urls: ["https://example.com/x"] },
      destinationOccurrence: { id: "plain" },
      gridId: "g1", userId: "u1", dispatch: () => {},
      socket: { connected: true, emit: () => {} },
      onIntakeResult: (r) => seen.push(r),
    });
    expect(res.ok).toBe(true); // the route ran
    expect(seen[0]).toMatchObject({ ok: false });
  });
});
