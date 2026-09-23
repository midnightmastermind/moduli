// A REFUSED DUPLICATE WHOSE HOLDER NOBODY LISTS IS A PERMANENT DEAD END.
//
// Measured twice on poms grid. 2026-09-23: today's Schedule column `8241d889`
// reached Mongo with `schedule:col:2026-09-23`, its 49 slots, and `parentId`
// naming the Schedule page — and the page's `occurrences[]` never learned it.
// Every renderer reads the PARENT's list, so the column rendered NOWHERE, while
// `refusedDuplicateCreates` correctly refused every rebuild as a duplicate of
// it. The thing blocking the repair WAS the thing needing repair.
//
// A census run before writing this found one more still live, unreachable since
// the day it was made:
//
//   25,285 occurrences · 1,776 signed · 76 signatureUnique · 1 listed by nobody
//   daypage:col:2026-08-26  parent 8gpoqzx32h7  5 children  2026-08-26
//
// The fix is NOT to allow the duplicate — that mints a second column and leaves
// the first as debris. It is to re-list the one that exists.
import { describe, it, expect } from "vitest";
import { adoptableHolders, DEAD_HOLDER_MIN_AGE_MS } from "../utils/duplicateSignature.js";

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const OLD = new Date(NOW - DEAD_HOLDER_MIN_AGE_MS - 60_000).toISOString();

const uniq = (id, over = {}) => ({
  id, parentId: null, identitySignature: null, createdAt: OLD, ...over,
  meta: { ...(over.meta || {}), signatureUnique: true },
});
const create = (o) => ({ occurrence: o });
const run = (batch, cache, refused) =>
  adoptableHolders(batch, cache, { refused: new Set(refused), now: NOW });

describe("adopting a holder no parent lists", () => {
  it("re-lists the holder the refusal pointed at", () => {
    const cache = {
      page: { id: "page", occurrences: ["other"] },                 // does NOT list the holder
      held: uniq("held", { parentId: "page", identitySignature: "schedule:col:2026-09-23" }),
    };
    const out = run([create(uniq("new", { parentId: "page", identitySignature: "schedule:col:2026-09-23" }))],
      cache, ["new"]);
    expect(out).toEqual([{ holderId: "held", parentId: "page" }]);
  });

  // THE CONTROL, and it is the one that matters: the ordinary refusal — a
  // holder the parent DOES list — must write nothing. Without it, "unreachable
  // holders get adopted" is equally satisfied by a pass that re-pushes every
  // refused build's holder on every load.
  it("writes NOTHING when the parent already lists the holder", () => {
    const cache = {
      page: { id: "page", occurrences: ["held"] },
      held: uniq("held", { parentId: "page", identitySignature: "schedule:col:2026-09-23" }),
    };
    expect(run([create(uniq("new", { parentId: "page", identitySignature: "schedule:col:2026-09-23" }))],
      cache, ["new"])).toEqual([]);
  });

  // `create_batch` emits a child before its parent's list write lands, so a
  // holder seconds old may be about to be listed by a write already in flight.
  // Same floor, same reason, as `isDeadHolder`.
  it("leaves a just-created holder alone — its listing may be in flight", () => {
    const cache = {
      page: { id: "page", occurrences: [] },
      held: uniq("held", {
        parentId: "page", identitySignature: "schedule:col:2026-09-23",
        createdAt: new Date(NOW - 30_000).toISOString(),
      }),
    };
    expect(run([create(uniq("new", { parentId: "page", identitySignature: "schedule:col:2026-09-23" }))],
      cache, ["new"])).toEqual([]);
  });

  // A create that was NOT refused is a legitimate new row; its parent's other
  // children are none of this pass's business. The batch carries BOTH kinds so
  // the refused-only rule has something to discriminate against — checking a
  // batch with no refusals at all proves nothing, because the function returns
  // early on an empty refusal set anyway.
  it("only considers creates that were actually refused", () => {
    const cache = {
      page: { id: "page", occurrences: [] },
      held: uniq("held", { parentId: "page", identitySignature: "schedule:col:2026-09-23" }),
      page2: { id: "page2", occurrences: [] },
      held2: uniq("held2", { parentId: "page2", identitySignature: "daypage:col:2026-09-23" }),
    };
    const out = run([
      create(uniq("new", { parentId: "page", identitySignature: "schedule:col:2026-09-23" })),
      create(uniq("fine", { parentId: "page2", identitySignature: "daypage:col:2026-09-23" })),
    ], cache, ["new"]);
    expect(out).toEqual([{ holderId: "held", parentId: "page" }]);
  });

  // Uniqueness is opt-in on BOTH sides everywhere else in this file; an
  // unflagged row is a shared MARKER (poms grid has eight template layers
  // sharing "day-container" under one page), and adopting one would re-list a
  // row someone deliberately took out of a list.
  it("ignores a holder that never opted into unique identity", () => {
    const cache = {
      page: { id: "page", occurrences: [] },
      held: { id: "held", parentId: "page", identitySignature: "day-container", createdAt: OLD, meta: {} },
    };
    expect(run([create(uniq("new", { parentId: "page", identitySignature: "day-container" }))],
      cache, ["new"])).toEqual([]);
  });

  it("never adopts the refused create itself, and never names a parent that is gone", () => {
    const selfOnly = { page: { id: "page", occurrences: [] } };
    expect(run([create(uniq("new", { parentId: "page", identitySignature: "s" }))], selfOnly, ["new"])).toEqual([]);
    const noParent = { held: uniq("held", { parentId: "gone", identitySignature: "s" }) };
    expect(run([create(uniq("new", { parentId: "gone", identitySignature: "s" }))], noParent, ["new"])).toEqual([]);
  });

  it("reports each holder once even when a batch refuses several creates for it", () => {
    const cache = {
      page: { id: "page", occurrences: [] },
      held: uniq("held", { parentId: "page", identitySignature: "s" }),
    };
    const out = run([
      create(uniq("a", { parentId: "page", identitySignature: "s" })),
      create(uniq("b", { parentId: "page", identitySignature: "s" })),
    ], cache, ["a", "b"]);
    expect(out).toEqual([{ holderId: "held", parentId: "page" }]);
  });
});
