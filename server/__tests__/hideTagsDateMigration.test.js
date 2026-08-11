// 0071 writes a visibility default that applies to EVERY occurrence on the grid,
// so the tests weigh the merge (which must not clobber a page's existing intent)
// and the refusal.
import { describe, it, expect } from "vitest";
import { mergePageHideList } from "../migrations/0071-hide-tags-everywhere-date-on-three-pages.mjs";

const TAGS = "f-tags", DATE = "f-date", SLOT = "f-slot", SEEN = "f-seen";
const ids = { tagsId: TAGS, dateId: DATE };

describe("0071 mergePageHideList", () => {
  it("hides Tags on a page that hid nothing before", () => {
    expect(mergePageHideList(null, ids)).toEqual([TAGS]);
    expect(mergePageHideList(undefined, ids)).toEqual([TAGS]);
  });

  // THE SCHEDULE CASE. It hid [Date, Time Slot, Last Seen] since 2026-07-11 so
  // its rows show Completed only. The ask names Date; replacing the list
  // wholesale would silently un-hide two fields nobody mentioned.
  it("drops Date but KEEPS everything else the page already hid", () => {
    expect(mergePageHideList({ mode: "hide", fieldIds: [DATE, SLOT, SEEN] }, ids))
      .toEqual([TAGS, SLOT, SEEN]);
  });

  it("does not duplicate Tags when the page already hid it", () => {
    expect(mergePageHideList({ mode: "hide", fieldIds: [TAGS, SLOT] }, ids)).toEqual([TAGS, SLOT]);
  });

  it("is idempotent — re-running produces the same list", () => {
    const once = mergePageHideList({ mode: "hide", fieldIds: [DATE, SLOT] }, ids);
    expect(mergePageHideList({ mode: "hide", fieldIds: once }, ids)).toEqual(once);
  });

  // A show-mode list is a WHITELIST expressing a different intent entirely —
  // carrying its ids into a hide list would invert their meaning.
  it("ignores a SHOW-mode list rather than inverting its meaning", () => {
    expect(mergePageHideList({ mode: "show", fieldIds: [SLOT, SEEN] }, ids)).toEqual([TAGS]);
  });

  it("tolerates a malformed fieldIds", () => {
    expect(mergePageHideList({ mode: "hide", fieldIds: "nope" }, ids)).toEqual([TAGS]);
  });
});
