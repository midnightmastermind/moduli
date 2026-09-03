// __tests__/gridIntegrity.test.js
//
// Each case here corresponds to a defect that was actually live and was found
// by hand in the 2026-07-29 audit, months after it was introduced. The point of
// the checker is that none of them can be silent again — so the tests assert
// both that a real defect is caught AND that the legitimate look-alike is not.
import { describe, it, expect } from "vitest";
import { checkGridIntegrity, reportGridIntegrity, ORPHAN_MODULE_ERROR_AT } from "../utils/gridIntegrity.js";

const mod = (id, extra = {}) => ({ id, role: "instance", label: id, fieldBindings: [], ...extra });
const occ = (id, moduleId, extra = {}) => ({ id, moduleId, occurrences: [], fields: {}, ...extra });
const op = (name, pipeline = {}, extra = {}) => ({ name, pipeline, enabled: true, triggerTypes: ["onLoad"], ...extra });
const codes = (f) => f.map(x => x.code);

describe("dangling child refs", () => {
  it("flags a parent listing a child that does not exist", () => {
    const f = checkGridIntegrity({
      modules: [mod("m1")],
      occurrences: [occ("p", "m1", { occurrences: ["real", "ghost"] }), occ("real", "m1")],
    });
    const hit = f.find(x => x.code === "dangling-child-ref");
    expect(hit.level).toBe("error");
    expect(hit.message).toMatch(/1 child id/);
    expect(hit.ids).toEqual(["p→ghost"]);
  });

  it("is quiet when every child resolves", () => {
    const f = checkGridIntegrity({
      modules: [mod("m1")],
      occurrences: [occ("p", "m1", { occurrences: ["c"] }), occ("c", "m1")],
    });
    expect(codes(f)).not.toContain("dangling-child-ref");
  });
});

describe("missing module", () => {
  it("flags an occurrence whose module is gone", () => {
    const f = checkGridIntegrity({ modules: [], occurrences: [occ("o1", "nope")] });
    expect(f.find(x => x.code === "missing-module").level).toBe("error");
  });

  // The split, added 2026-08-07. These were reported as ONE code, and on test
  // grid 2 twenty-one of the twenty-two matches carried no moduleId at all —
  // so the message ("references a module that does not exist") described a
  // pointer that was not there. Different cause, different remedy, so the two
  // must not share a code.
  it("reports a moduleId-less occurrence under its OWN code, not missing-module", () => {
    const f = checkGridIntegrity({ modules: [], occurrences: [occ("o1", null)] });
    expect(codes(f)).toContain("module-less-occurrence");
    expect(codes(f)).not.toContain("missing-module");
    expect(f.find(x => x.code === "module-less-occurrence").level).toBe("error");
  });

  it("keeps the two codes separate when BOTH shapes are present", () => {
    const f = checkGridIntegrity({
      modules: [mod("m1")],
      occurrences: [occ("ok", "m1"), occ("bad", "gone"), occ("none", null), occ("none2", undefined)],
    });
    const ml = f.find(x => x.code === "module-less-occurrence");
    const mm = f.find(x => x.code === "missing-module");
    expect(ml.ids).toEqual(["none", "none2"]);
    expect(mm.ids).toEqual(["bad"]);
  });

  it("a healthy grid reports neither", () => {
    const f = checkGridIntegrity({ modules: [mod("m1")], occurrences: [occ("o1", "m1")] });
    expect(codes(f)).not.toContain("missing-module");
    expect(codes(f)).not.toContain("module-less-occurrence");
  });
});

describe("contended presentation targets", () => {
  const styleOp = (name) => op(name, { steps: [{ type: "action", cfg: { path: "$slot.ownStyle.bg" } }] });

  it("flags two enabled ops writing the same ownStyle target", () => {
    const f = checkGridIntegrity({ operations: [styleOp("A"), styleOp("B")] });
    const hit = f.find(x => x.code === "contended-write-target");
    expect(hit.message).toMatch(/ownStyle\.bg/);
    expect(hit.message).toMatch(/A, B/);
  });

  it("normalises the loop variable — $slot and $s are the same target", () => {
    const f = checkGridIntegrity({ operations: [
      op("A", { steps: [{ cfg: { path: "$slot.ownStyle.bg" } }] }),
      op("B", { steps: [{ cfg: { path: "$s.ownStyle.bg" } }] }),
    ]});
    expect(codes(f)).toContain("contended-write-target");
  });

  it("ignores a DISABLED op — it isn't contending with anything", () => {
    const f = checkGridIntegrity({ operations: [styleOp("A"), { ...styleOp("B"), enabled: false }] });
    expect(codes(f)).not.toContain("contended-write-target");
  });

  it("does NOT flag several ops writing the same FIELD — that is normal", () => {
    // The six per-muscle Volume trackers all feed Total Reps on purpose, and
    // Stamp/Clear Date are a set/clear pair. Flagging those made the check
    // noise, and a check that cries wolf gets ignored.
    const f = checkGridIntegrity({ operations: [
      op("Chest Volume", { steps: [{ cfg: { path: "$g.fields.total.value" } }] }),
      op("Back Volume", { steps: [{ cfg: { path: "$g.fields.total.value" } }] }),
    ]});
    expect(codes(f)).not.toContain("contended-write-target");
  });
});

describe("unused fields", () => {
  it("flags a field nothing binds, values, or references", () => {
    const f = checkGridIntegrity({
      fields: [{ id: "f1", name: "Ghost" }, { id: "f2", name: "Used" }],
      modules: [mod("m1", { fieldBindings: [{ fieldId: "f2" }] })],
      occurrences: [occ("o1", "m1")],
    });
    const hit = f.find(x => x.code === "unused-field");
    expect(hit.ids).toEqual(["Ghost"]);
  });

  it("counts a field as used when only an OPERATION mentions it", () => {
    const f = checkGridIntegrity({
      fields: [{ id: "f1", name: "OpOnly" }],
      operations: [op("Writer", { steps: [{ cfg: { path: "$x.fields.f1.value" } }] })],
    });
    expect(codes(f)).not.toContain("unused-field");
  });

  it("counts a field as used when only an occurrence VALUES it", () => {
    const f = checkGridIntegrity({
      fields: [{ id: "f1", name: "ValueOnly" }],
      modules: [mod("m1")],
      occurrences: [occ("o1", "m1", { fields: { f1: { value: 3 } } })],
    });
    expect(codes(f)).not.toContain("unused-field");
  });
});

describe("duplicate names", () => {
  it("says NOTHING about duplicate field names — the rule is retired", () => {
    // User, 2026-08-24: *"fields dont have to be unique name based by the way"*.
    // The name is a LABEL and identity is the id. This warned for weeks on every
    // grid, on the intended state — and a checker that reports what you meant is
    // one people learn to scroll past.
    const f = checkGridIntegrity({ fields: [{ id: "a", name: "Water" }, { id: "b", name: "water" }] });
    expect(codes(f)).not.toContain("duplicate-field-name");
  });

  it("still flags a duplicate OPERATION name — that one IS identity", () => {
    // The discriminating pair: `RUN_OPERATION` resolves by NAME, so two
    // operations sharing one makes which runs a coin flip. Retiring the field
    // rule must not quietly retire this one.
    const f = checkGridIntegrity({ operations: [op("Same"), op("Same")] });
    expect(f.find(x => x.code === "duplicate-operation-name").level).toBe("error");
  });

  it("flags duplicate operation names — RUN_OPERATION resolves by name", () => {
    const f = checkGridIntegrity({ operations: [op("Same"), op("Same")] });
    expect(f.find(x => x.code === "duplicate-operation-name").level).toBe("error");
  });
});

describe("unfireable operations", () => {
  it("warns about an enabled op with no trigger and no schedule", () => {
    const f = checkGridIntegrity({ operations: [{ name: "Inert", enabled: true, pipeline: {} }] });
    expect(f.find(x => x.code === "unfireable-operation").level).toBe("warn");
  });

  it("does not warn when a schedule supplies the fire", () => {
    const f = checkGridIntegrity({ operations: [
      { name: "Timed", enabled: true, pipeline: {}, triggerTypes: [], schedule: { kind: "interval" } },
    ]});
    expect(codes(f)).not.toContain("unfireable-operation");
  });
});

describe("reportGridIntegrity", () => {
  it("returns true (and says so) for a clean grid", () => {
    const out = [];
    expect(reportGridIntegrity([], { log: (m) => out.push(m) })).toBe(true);
    expect(out.join("\n")).toMatch(/clean/);
  });

  it("returns FALSE when there is any error, but true when only warnings", () => {
    const noop = () => {};
    expect(reportGridIntegrity([{ level: "error", code: "x", message: "m" }], { log: noop })).toBe(false);
    expect(reportGridIntegrity([{ level: "warn", code: "x", message: "m" }], { log: noop })).toBe(true);
  });
});

describe("inert kind on leaf roles", () => {
  it("flags an instance carrying a kind — the icon resolver prefers kind over role", () => {
    const f = checkGridIntegrity({ modules: [
      { id: "m1", role: "instance", kind: "board" },
      { id: "m2", role: "panel", kind: "board" },
    ]});
    const hit = f.find(x => x.code === "inert-kind");
    expect(hit.level).toBe("warn");
    expect(hit.ids).toEqual(expect.arrayContaining(["instance/board×1", "panel/board×1"]));
  });

  it("leaves the roles where kind is MEANINGFUL alone", () => {
    // container/page/artifact/textblock all render by kind — flagging those
    // would make the check useless noise.
    const f = checkGridIntegrity({ modules: [
      { id: "c", role: "container", kind: "doc" },
      { id: "p", role: "page", kind: "board" },
      { id: "a", role: "artifact", kind: "image" },
      { id: "t", role: "textblock", kind: "inline" },
    ]});
    expect(f.map(x => x.code)).not.toContain("inert-kind");
  });

  it("is quiet when a leaf carries no kind at all", () => {
    const f = checkGridIntegrity({ modules: [{ id: "m1", role: "instance" }] });
    expect(f.map(x => x.code)).not.toContain("inert-kind");
  });
});

describe("unsigned nodes inside a template", () => {
  // APPLY_TEMPLATE mode:"merge" matches by identitySignature and RECURSES into
  // whatever it matched, so an unsigned node is re-cloned on every apply. On
  // 2026-07-31 the Day Page template's question container was unsigned and one
  // column had collected 23 empty copies of it — one per app load.
  // A template is a child of the protected "Templates" FOLDER — location is the
  // marker (migration 0035 retired meta.templateModule, which it now unsets on
  // roots while leaving it on nested nodes, i.e. exactly backwards).
  const tplMod = (id, label) => mod(id, { role: "container", label });
  const TPL_FOLDER = [{ id: "tpl-f", name: "Templates", meta: { protected: true } }];

  it("flags a template child that carries no identitySignature", () => {
    const f = checkGridIntegrity({
      folders: TPL_FOLDER,
      modules: [tplMod("mRoot", "Day Page"), tplMod("mSec", "Daily Question")],
      occurrences: [
        occ("root", "mRoot", { parentId: "tpl-f", occurrences: ["sec"] }),
        occ("sec", "mSec"),
      ],
    });
    const hit = f.find(x => x.code === "unsigned-template-node");
    expect(hit.level).toBe("error");
    expect(hit.ids).toEqual(["Daily Question in Day Page"]);
  });

  it("follows the whole subtree — an unsigned GRANDchild duplicates too", () => {
    // The exact 2026-07-31 shape: the section was signed, its question
    // container was not, so merge matched the section and cloned the child.
    const f = checkGridIntegrity({
      folders: TPL_FOLDER,
      modules: [tplMod("mRoot", "Day Page"), tplMod("mSec", "Daily Question"), tplMod("mQ", "question")],
      occurrences: [
        occ("root", "mRoot", { parentId: "tpl-f", occurrences: ["sec"] }),
        occ("sec", "mSec", { identitySignature: "daypage:Daily Question", occurrences: ["q"] }),
        occ("q", "mQ"),
      ],
    });
    expect(f.find(x => x.code === "unsigned-template-node").ids).toEqual(["question in Day Page"]);
  });

  it("is quiet when every node below the root is signed", () => {
    const f = checkGridIntegrity({
      folders: TPL_FOLDER,
      modules: [tplMod("mRoot", "Day Page"), tplMod("mSec", "Daily Question"), tplMod("mQ", "question")],
      occurrences: [
        occ("root", "mRoot", { parentId: "tpl-f", occurrences: ["sec"] }),
        occ("sec", "mSec", { identitySignature: "daypage:Daily Question", occurrences: ["q"] }),
        occ("q", "mQ", { identitySignature: "daypage:Daily Question/question" }),
      ],
    });
    expect(codes(f)).not.toContain("unsigned-template-node");
  });

  it("checks STRUCTURE only — an unsigned instance is meant to clone fresh", () => {
    // The Schedule template's routine items land in a NEW day column each day,
    // so they cannot duplicate. The bug this rule exists for was duplicated
    // CONTAINERS (23 Daily Question wrappers in one day).
    const f = checkGridIntegrity({
      folders: TPL_FOLDER,
      modules: [tplMod("mRoot", "Schedule Template"), mod("mItem", { role: "instance", label: "Drink" })],
      occurrences: [
        occ("root", "mRoot", { parentId: "tpl-f", occurrences: ["item"] }),
        occ("item", "mItem"),
      ],
    });
    expect(codes(f)).not.toContain("unsigned-template-node");
  });

  it("exempts a wrapper PAGE's child — it is the effective apply root", () => {
    // Migration 0035 wraps container-templates in a page, and both build ops
    // apply with unwrapRoot:true, so the wrapper's child is matched by the
    // target exactly the way a bare root is.
    const f = checkGridIntegrity({
      folders: TPL_FOLDER,
      modules: [
        mod("mWrap", { role: "page", kind: "doc", label: "Day Page" }),
        tplMod("mInner", "Day Page"),
      ],
      occurrences: [
        occ("wrap", "mWrap", { parentId: "tpl-f", occurrences: ["inner"] }),
        occ("inner", "mInner"),
      ],
    });
    expect(codes(f)).not.toContain("unsigned-template-node");
  });

  it("keys off LOCATION, not the retired templateModule marker", () => {
    // Migration 0035 unsets templateModule on template ROOTS but leaves it on
    // nested nodes, so the marker now points at exactly the wrong occurrences.
    // A subtree sitting OUTSIDE the Templates folder is not a template, even
    // when its modules still carry the old flag.
    const f = checkGridIntegrity({
      folders: TPL_FOLDER,
      modules: [
        mod("mOut", { role: "container", label: "Stale", meta: { templateModule: true } }),
        mod("mKid", { role: "container", label: "Kid", meta: { templateModule: true } }),
      ],
      occurrences: [
        occ("out", "mOut", { parentId: "somewhere-else", occurrences: ["kid"] }),
        occ("kid", "mKid"),
      ],
    });
    expect(codes(f)).not.toContain("unsigned-template-node");
  });

  it("exempts the ROOT — it is matched by the apply target, not by a signature", () => {
    const f = checkGridIntegrity({
      folders: TPL_FOLDER,
      modules: [tplMod("mRoot", "Day Page")],
      occurrences: [occ("root", "mRoot", { parentId: "tpl-f" })],
    });
    expect(codes(f)).not.toContain("unsigned-template-node");
  });

  it("reports a node ONCE even when reachable from several roots", () => {
    // A node can be reached from more than one root, so a naive walk reports
    // it once per ancestor.
    const f = checkGridIntegrity({
      folders: TPL_FOLDER,
      modules: [tplMod("mRoot", "Project"), tplMod("mMid", "Kanban"), tplMod("mLeaf", "Backburner")],
      occurrences: [
        occ("root", "mRoot", { parentId: "tpl-f", occurrences: ["mid"] }),
        occ("mid", "mMid", { occurrences: ["leaf"] }),
        occ("leaf", "mLeaf"),
      ],
    });
    const hit = f.find(x => x.code === "unsigned-template-node");
    expect(hit.ids).toEqual(["Kanban in Project", "Backburner in Project"]);
  });

  it("checks templates reached only through a clone's appliedFromTemplateId", () => {
    const f = checkGridIntegrity({
      folders: TPL_FOLDER,
      modules: [mod("mRoot", { role: "container", label: "Day Page" }), mod("mSec", { role: "container", label: "Journal" })],
      occurrences: [
        occ("root", "mRoot", { parentId: "tpl-f", occurrences: ["sec"] }),
        occ("sec", "mSec"),
        occ("clone", "mRoot", { meta: { appliedFromTemplateId: "root" } }),
      ],
    });
    expect(f.find(x => x.code === "unsigned-template-node").ids).toEqual(["Journal in Day Page"]);
  });
});

describe("duplicate sections on a template-applied page", () => {
  // The damage rule: what a merge with a missed signature actually produces,
  // and what the user reported ("the daypage for yesterday added all the
  // sections twice") before either signature gap had been found.
  const sec = (id, label) => mod(id, { role: "container", label });

  it("flags the same section twice under one applied page", () => {
    const f = checkGridIntegrity({
      modules: [mod("mCol", { role: "container", label: "Day Page - 2026-07-30" }), sec("mJ", "Journal")],
      occurrences: [
        occ("col", "mCol", { meta: { appliedFromTemplateId: "tpl" }, occurrences: ["j1", "j2"] }),
        occ("j1", "mJ", { parentId: "col" }),
        occ("j2", "mJ", { parentId: "col" }),
      ],
    });
    const hit = f.find(x => x.code === "duplicate-template-section");
    expect(hit.level).toBe("error");
    expect(hit.ids).toEqual(["Day Page - 2026-07-30 › Journal×2"]);
  });

  it("does not count a container MULTI-PARENTED in from somewhere else", () => {
    // Todo is the Schedule day-column's own container, listed by the day page
    // as well. Its parentId points at the schedule, so it is not the day
    // page's to count — and must never be "deduped" away.
    const f = checkGridIntegrity({
      modules: [mod("mCol", { role: "container", label: "Day Page" }), sec("mT", "Todo")],
      occurrences: [
        occ("col", "mCol", { meta: { appliedFromTemplateId: "tpl" }, occurrences: ["t1", "t2"] }),
        occ("t1", "mT", { parentId: "elsewhere" }),
        occ("t2", "mT", { parentId: "elsewhere" }),
      ],
    });
    expect(codes(f)).not.toContain("duplicate-template-section");
  });

  it("is quiet on a page that was never applied from a template", () => {
    const f = checkGridIntegrity({
      modules: [mod("mP", { role: "container", label: "Page" }), sec("mJ", "Journal")],
      occurrences: [
        occ("p", "mP", { occurrences: ["j1", "j2"] }),
        occ("j1", "mJ", { parentId: "p" }),
        occ("j2", "mJ", { parentId: "p" }),
      ],
    });
    expect(codes(f)).not.toContain("duplicate-template-section");
  });
});

// A COPY-LINK SOURCE carrying a filter value stamps every copy it mints, and
// the copies are then hidden whenever the filter moves. Live on poms grid
// 2026-08-19: 21 of 51 sources carried the previous day's date, so 21 of that
// morning's timeslots were invisible with nothing reporting why.
describe("dated-copy-link-source", () => {
  const DATE = "fld-date";
  const grid = {
    activeFilterValues: { [DATE]: "2026-08-19" },
    namedFilters: [{ id: "daily", conditions: [{ fieldId: DATE, comparator: "SAME_DAY" }] }],
  };
  const world = (srcFields) => ({
    grid,
    modules: [{ id: "m1", role: "container", kind: "board", label: "slot" }],
    occurrences: [
      { id: "src", moduleId: "m1", label: "9:00am", fields: srcFields },
      { id: "copy", moduleId: "m1", label: "9:00am", meta: { copyLinkSource: "src" } },
    ],
  });
  const codes = (w) => checkGridIntegrity(w).map(f => f.code);

  it("flags a source carrying a value in a filtered field", () => {
    expect(codes(world({ [DATE]: { value: "2026-08-18" } }))).toContain("dated-copy-link-source");
  });

  it("says nothing when the source carries no filter value — the healthy shape", () => {
    // test grid 1 measured 61 copy-link sources and 0 dated; that is the state
    // this rule exists to preserve, so a false positive here would be noise on
    // a grid that is fine.
    expect(codes(world({}))).not.toContain("dated-copy-link-source");
  });

  it("ignores a value in a field the grid does NOT filter on", () => {
    expect(codes(world({ "fld-other": { value: "anything" } }))).not.toContain("dated-copy-link-source");
  });

  it("ignores an occurrence nothing copy-links from", () => {
    const w = world({ [DATE]: { value: "2026-08-18" } });
    w.occurrences = w.occurrences.filter(o => o.id !== "copy");   // no copy → not a source
    expect(codes(w)).not.toContain("dated-copy-link-source");
  });

  it("stays silent on a grid that names no filter fields at all", () => {
    const w = world({ [DATE]: { value: "2026-08-18" } });
    w.grid = { activeFilterValues: {}, namedFilters: [] };
    expect(codes(w)).not.toContain("dated-copy-link-source");
  });
});

describe("unreachable-board", () => {
  // The live shape, 2026-08-20: a board is a PAIR — a page/board homed in a
  // folder, listing a container/board whose own parentId is null. `0158` minted
  // the container and no page, so the Medications board held four medications
  // that could not be opened. Every DB read-back said it was fine.
  const boardMod = (id) => mod(id, { role: "container", kind: "board" });
  const pageMod = (id) => mod(id, { role: "page", kind: "board" });
  const feed = { enabled: true, conditions: [{ fieldId: "f-tag", comparator: "CONTAINS", value: "t" }] };

  const pair = ({ listed }) => ({
    modules: [pageMod("m-page"), boardMod("m-board")],
    occurrences: [
      occ("page", "m-page", { parentId: "folder-1", occurrences: listed ? ["board"] : [] }),
      occ("board", "m-board", { parentId: null, feed }),
    ],
  });

  it("flags a feed-backed board that no page lists", () => {
    const hit = checkGridIntegrity(pair({ listed: false })).find(x => x.code === "unreachable-board");
    expect(hit.level).toBe("error");
    expect(hit.message).toMatch(/1 feed-backed board/);
    expect(hit.ids).toEqual(["m-board"]);
  });

  it("stays quiet once a page lists it — the repair", () => {
    expect(codes(checkGridIntegrity(pair({ listed: true })))).not.toContain("unreachable-board");
  });

  // The discriminating case, and the reason the rule tests the feed: 12 live
  // `<ingredient> — files` containers on poms grid are parented to nothing and
  // listed by nobody, and are reached through a FIELD VALUE instead. A rule
  // that flagged those would have been noise on the day it shipped.
  it("does NOT flag a board container that carries no feed", () => {
    const w = pair({ listed: false });
    w.occurrences = w.occurrences.map(o => (o.id === "board" ? { ...o, feed: null } : o));
    expect(codes(checkGridIntegrity(w))).not.toContain("unreachable-board");
  });

  it("does NOT flag a feed-backed board that is parented rather than listed", () => {
    const w = pair({ listed: false });
    w.occurrences = w.occurrences.map(o => (o.id === "board" ? { ...o, parentId: "page" } : o));
    expect(codes(checkGridIntegrity(w))).not.toContain("unreachable-board");
  });

  it("does NOT flag a feed-backed container of another kind", () => {
    const w = pair({ listed: false });
    w.modules = [pageMod("m-page"), mod("m-board", { role: "container", kind: "doc" })];
    expect(codes(checkGridIntegrity(w))).not.toContain("unreachable-board");
  });
});

// ── orphan-module ──────────────────────────────────────────────────────────
// The INVERSE of `module-less-occurrence`: a module no occurrence places.
// There was no rule for it, which is how poms grid reached 135 unnoticed
// (user, 2026-08-23: "why do we keep having so many of them"). Two causes feed
// it — placing a row CLONES its module, and only the runtime delete path
// sweeps the clone, so migrations leave theirs behind.
describe("orphan-module", () => {
  const M = (id, extra = {}) => ({ id, label: id, ...extra });
  const O = (id, moduleId) => ({ id, moduleId, fields: {} });
  const find = (f, code) => f.find(x => x.code === code);
  const run = (args) => checkGridIntegrity({ modules: [], occurrences: [], fields: [], operations: [], textmaps: [], ...args });

  it("flags a module nothing places", () => {
    const f = run({ modules: [M("dead"), M("live")], occurrences: [O("o1", "live")] });
    const hit = find(f, "orphan-module");
    expect(hit).toBeTruthy();
    expect(hit.ids).toContain("dead");
    expect(hit.ids).not.toContain("live");
  });

  it("stays silent when every module is placed — the control", () => {
    // Without this, a rule that flagged everything would pass the test above.
    const f = run({ modules: [M("live")], occurrences: [O("o1", "live")] });
    expect(find(f, "orphan-module")).toBeFalsy();
  });

  it("SKIPS ENTIRELY when the caller supplies no textmaps", () => {
    // A textmap can embed a module. A caller that cannot decompress them would
    // make this rule flag live modules — the cry-wolf guard that gets weakened
    // the first time it fires. Reporting nothing beats reporting a number
    // nobody can stand behind.
    const f = checkGridIntegrity({ modules: [M("dead")], occurrences: [], fields: [], operations: [] });
    expect(find(f, "orphan-module")).toBeFalsy();
  });

  it("does not flag a module a TEXTMAP embeds", () => {
    const f = run({ modules: [M("dead")], occurrences: [],
      textmaps: [{ type: "doc", content: [{ type: "moduleEmbed", attrs: { moduleId: "dead" } }] }] });
    expect(find(f, "orphan-module")).toBeFalsy();
  });

  it("does not flag a module an OPERATION names", () => {
    const f = run({ modules: [M("dead")], occurrences: [],
      operations: [{ name: "X", pipeline: { steps: [{ config: { expr: "$allItemsById.dead" } }] } }] });
    expect(find(f, "orphan-module")).toBeFalsy();
  });

  it("does not flag a TEMPLATE ROOT — having no placement is its normal state", () => {
    const f = run({ modules: [M("tpl", { meta: { templateModule: true } })], occurrences: [] });
    expect(find(f, "orphan-module")).toBeFalsy();
  });

  it("warns below the threshold and ERRORS above it", () => {
    // A handful is the ordinary residue of a few deletes. A hundred has stopped
    // being incidental, and a warning is exactly what let the last 135 pile up.
    const few = run({ modules: Array.from({ length: 3 }, (_, i) => M(`d${i}`)) });
    expect(find(few, "orphan-module").level).toBe("warn");
    const many = run({ modules: Array.from({ length: ORPHAN_MODULE_ERROR_AT }, (_, i) => M(`d${i}`)) });
    expect(find(many, "orphan-module").level).toBe("error");
  });
});

// ── duplicate template application ──────────────────────────────────────────
//
// The class rule #10 could not see. It looks at a template-applied node's
// CHILDREN; duplicate day columns are SIBLINGS under the board, so nine of them
// accumulated on 2026-09-02 with `checkGrid` reporting clean the whole time.
//
// The shape here is the real one: several applications of one template under a
// board are CORRECT (one day column per date) and what tells them apart is the
// value the template stamped. Every case below is calibrated against live data —
// the rule reads 0 on all six grids and fires on exactly the pre-repair state.
describe("duplicate template application", () => {
  const board = occ("board", "mBoard", { occurrences: ["a", "b"] });
  const applied = (id, date) =>
    occ(id, "mCol", {
      parentId: "board",
      meta: { appliedFromTemplateId: "tpl" },
      fields: { fDate: { value: date } },
      label: `col ${date}`,
    });

  it("flags two applications of one template that carry identical fields", () => {
    const f = checkGridIntegrity({
      modules: [mod("mBoard", { label: "Day Page" }), mod("mCol", { role: "container" })],
      occurrences: [board, applied("a", "2026-09-02"), applied("b", "2026-09-02")],
    });
    const hit = f.find((x) => x.code === "duplicate-template-application");
    expect(hit.level).toBe("error");
    expect(hit.ids).toEqual(["Day Page › col 2026-09-02 ×2"]);
  });

  // THE CASE THAT MAKES THE RULE USABLE. A board legitimately holds one
  // application per date; without this the rule would fire on every healthy
  // grid on day one and get weakened.
  it("is quiet when the applications differ in the value the template stamped", () => {
    const f = checkGridIntegrity({
      modules: [mod("mBoard"), mod("mCol", { role: "container" })],
      occurrences: [board, applied("a", "2026-09-02"), applied("b", "2026-09-03")],
    });
    expect(codes(f)).not.toContain("duplicate-template-application");
  });

  // A PARENT THAT DOES NOT EXIST HAS NO SIBLINGS. Both false positives the rule
  // produced across the live grids were groups whose parentId names nothing —
  // eight weekday templates sharing a hand-authored signature, and two project
  // pages. A dangling ref is its own error with its own rule.
  it("is quiet when the shared parent does not exist", () => {
    const f = checkGridIntegrity({
      modules: [mod("mCol", { role: "container" })],
      occurrences: [
        occ("a", "mCol", { parentId: "gone", meta: { appliedFromTemplateId: "tpl" } }),
        occ("b", "mCol", { parentId: "gone", meta: { appliedFromTemplateId: "tpl" } }),
      ],
    });
    expect(codes(f)).not.toContain("duplicate-template-application");
  });

  it("is quiet for two siblings applied from DIFFERENT templates", () => {
    const f = checkGridIntegrity({
      modules: [mod("mBoard"), mod("mCol", { role: "container" })],
      occurrences: [
        board,
        occ("a", "mCol", { parentId: "board", meta: { appliedFromTemplateId: "tplA" } }),
        occ("b", "mCol", { parentId: "board", meta: { appliedFromTemplateId: "tplB" } }),
      ],
    });
    expect(codes(f)).not.toContain("duplicate-template-application");
  });

  it("is quiet for an ordinary sibling pair that came from no template", () => {
    const f = checkGridIntegrity({
      modules: [mod("mBoard"), mod("mCol", { role: "container" })],
      occurrences: [board, occ("a", "mCol", { parentId: "board" }), occ("b", "mCol", { parentId: "board" })],
    });
    expect(codes(f)).not.toContain("duplicate-template-application");
  });
});
