// 0067 removes a setting from protected live data, so the tests are about the
// GUARD: what it drops, and — carrying far more weight — what it refuses to.
// `0035` moved a real user page because its selector matched "things that look
// like templates"; the rule this file enforces is that a value is only removed
// when it is still exactly what the earlier migration is KNOWN to have written.
import { describe, it, expect, vi } from "vitest";
import { isMigrationWrittenWhitelist, up } from "../migrations/0067-auto-applied-fields-cascade.mjs";

const TAGS = "f-tags";
const DATE = "f-date";
const APPLIED = [TAGS, DATE];

describe("0067 isMigrationWrittenWhitelist", () => {
  it("recognises the shape 0064 wrote — show-mode naming an auto-applied field", () => {
    expect(isMigrationWrittenWhitelist({ mode: "show", fieldIds: [TAGS] }, APPLIED)).toBe(true);
  });

  // Each of these is somebody's deliberate choice, not the migration's footprint.
  it("REFUSES a whitelist naming a field that is not auto-applied", () => {
    expect(isMigrationWrittenWhitelist({ mode: "show", fieldIds: [TAGS, "f-other"] }, APPLIED)).toBe(false);
  });

  it("REFUSES hide-mode and off-mode — only a show-whitelist was ever written here", () => {
    expect(isMigrationWrittenWhitelist({ mode: "hide", fieldIds: [TAGS] }, APPLIED)).toBe(false);
    expect(isMigrationWrittenWhitelist({ mode: "off" }, APPLIED)).toBe(false);
  });

  it("REFUSES an empty or malformed list rather than treating it as a match", () => {
    expect(isMigrationWrittenWhitelist({ mode: "show", fieldIds: [] }, APPLIED)).toBe(false);
    expect(isMigrationWrittenWhitelist({ mode: "show" }, APPLIED)).toBe(false);
    expect(isMigrationWrittenWhitelist(null, APPLIED)).toBe(false);
  });

  it("REFUSES when the grid names no auto-applied fields — nothing to match against", () => {
    expect(isMigrationWrittenWhitelist({ mode: "show", fieldIds: [TAGS] }, [])).toBe(false);
  });
});

// ── up(), driven against in-memory model stubs ──────────────────────────────
// Asserts on the WRITES that leave, never on which helper was called — the
// 2026-08-07 (6) probe lesson.
function harness({ meta, trackersFieldVisibility = { mode: "show", fieldIds: [TAGS] }, withTrackers = true }) {
  const gridSets = [];
  const occSets = [];
  const occs = withTrackers
    ? [{ id: "occ-trk", moduleId: "m-trk", fieldVisibility: trackersFieldVisibility }]
    : [];
  const models = {
    Grid: {
      findById: () => ({ lean: async () => ({ _id: "g1", meta }) }),
      updateOne: async (_q, u) => { gridSets.push(u); },
    },
    Occurrence: {
      find: () => ({ lean: async () => occs }),
      updateOne: async (q, u) => { occSets.push({ id: q.id, update: u }); },
    },
    Module: { find: () => ({ lean: async () => [{ id: "m-trk", role: "page", label: "Trackers" }] }) },
    Field: {
      find: () => ({ lean: async () => [
        { id: TAGS, name: "Tags" }, { id: DATE, name: "Date" },
      ] }),
    },
  };
  const logs = [];
  return { models, gridSets, occSets, logs, log: (m) => logs.push(m) };
}

const run = (h, dryRun = false) =>
  up({ gridId: "g1", models: h.models, log: h.log, dryRun });

describe("0067 up — the key rename", () => {
  it("renames the old key and unsets it in one write", async () => {
    const h = harness({ meta: { universalFieldIds: APPLIED } });
    await run(h);
    expect(h.gridSets[0].$set["meta.autoAppliedFieldIds"]).toEqual(APPLIED);
    expect(h.gridSets[0].$unset["meta.universalFieldIds"]).toBe("");
  });

  it("reports the fields by NAME, not by id", async () => {
    const h = harness({ meta: { universalFieldIds: APPLIED } });
    await run(h);
    expect(h.logs.join("\n")).toContain("[Tags, Date]");
  });

  it("is idempotent — a grid already renamed is not written again", async () => {
    const h = harness({ meta: { autoAppliedFieldIds: APPLIED }, trackersFieldVisibility: null });
    await run(h);
    expect(h.gridSets).toHaveLength(0);
    expect(h.occSets).toHaveLength(0);
  });

  it("with BOTH keys present, keeps the new one and drops only the stale one", async () => {
    // The client reads the new key, so it is the authoritative one; leaving the
    // old one behind is the only outcome that keeps the grid half-renamed.
    const h = harness({ meta: { universalFieldIds: ["f-stale"], autoAppliedFieldIds: APPLIED } });
    await run(h);
    expect(h.gridSets[0].$unset["meta.universalFieldIds"]).toBe("");
    expect(h.gridSets[0].$set).toBeUndefined();
  });

  it("a grid naming none is left entirely alone", async () => {
    const h = harness({ meta: {}, trackersFieldVisibility: null });
    await run(h);
    expect(h.gridSets).toHaveLength(0);
  });
});

describe("0067 up — the Trackers whitelist", () => {
  it("drops it by UNSETTING fieldVisibility, and touches nothing else", async () => {
    const h = harness({ meta: { universalFieldIds: APPLIED } });
    await run(h);
    expect(h.occSets).toEqual([{ id: "occ-trk", update: { $unset: { fieldVisibility: "" } } }]);
  });

  // The discriminating case: an edited whitelist is the USER's, not ours.
  it("REFUSES an edited whitelist, and says why", async () => {
    const h = harness({
      meta: { universalFieldIds: APPLIED },
      trackersFieldVisibility: { mode: "show", fieldIds: [TAGS, "f-mine"] },
    });
    await run(h);
    expect(h.occSets).toHaveLength(0);
    expect(h.logs.join("\n")).toContain("REFUSED");
  });

  it("says so plainly when there is no Trackers page", async () => {
    const h = harness({ meta: { universalFieldIds: APPLIED }, withTrackers: false });
    await run(h);
    expect(h.occSets).toHaveLength(0);
    expect(h.logs.join("\n")).toContain("no \"Trackers\" page");
  });

  it("a dry run reports the same decisions and writes NOTHING", async () => {
    const h = harness({ meta: { universalFieldIds: APPLIED } });
    await run(h, true);
    expect(h.gridSets).toHaveLength(0);
    expect(h.occSets).toHaveLength(0);
    const out = h.logs.join("\n");
    expect(out).toContain("RENAME");
    expect(out).toContain("DROPS its show-whitelist");
  });
});
