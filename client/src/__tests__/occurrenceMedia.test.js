// helpers/occurrenceMedia — THE resolver every thumbnail site reads through.
//
// The contract that matters: a media-role field's value is an OCCURRENCE ID
// pointing at a role:"artifact" occurrence. A legacy STRING value resolves to
// null on purpose — no fallback, because a passthrough would hide an
// unmigrated grid (migration 0043 is what fixes data, not this file).
import { describe, it, expect } from "vitest";
import {
  mediaFieldIdFor, filesFieldIdFor, primaryMediaOf, filesOf,
} from "../helpers/occurrenceMedia";

const F_MEDIA = "f-poster";
const F_FILES = "f-files";

function ctxOf({ occurrences = [], modules = [] } = {}) {
  const occurrencesById = {};
  for (const o of occurrences) occurrencesById[o.id] = o;
  const modulesById = {};
  for (const m of modules) modulesById[m.id] = m;
  return { occurrencesById, modulesById, fieldsById: {} };
}

// An artifact occurrence + its module, the shape artifactUpload mints.
function artifact(id, fileRef, kind = "image", extra = {}) {
  return {
    module: { id: `m-${id}`, role: "artifact", kind, fileRef, label: `${id}.jpg`, ...extra },
    occ: { id, moduleId: `m-${id}`, fields: {} },
  };
}

// The owner: an instance module binding media (+ optionally files).
function owner(fields, { files = true } = {}) {
  const bindings = [{ fieldId: F_MEDIA, role: "media" }];
  if (files) bindings.push({ fieldId: F_FILES, role: "files" });
  return {
    module: { id: "m-person", role: "instance", label: "Person", fieldBindings: bindings },
    occ: { id: "o-person", moduleId: "m-person", fields },
  };
}

describe("mediaFieldIdFor / filesFieldIdFor", () => {
  it("reads the binding ROLE, not a field name", () => {
    const { module } = owner({});
    expect(mediaFieldIdFor(module)).toBe(F_MEDIA);
    expect(filesFieldIdFor(module)).toBe(F_FILES);
  });

  it("returns null with no such binding", () => {
    expect(mediaFieldIdFor({ fieldBindings: [] })).toBe(null);
    expect(filesFieldIdFor({ fieldBindings: [{ fieldId: "x", role: "input" }] })).toBe(null);
    expect(mediaFieldIdFor(null)).toBe(null);
    expect(filesFieldIdFor(undefined)).toBe(null);
  });
});

describe("primaryMediaOf", () => {
  it("resolves an artifact-occurrence id to its module + src", () => {
    const a = artifact("a1", "user/2026-08/pic.jpg");
    const o = owner({ [F_MEDIA]: { value: "a1" } });
    const got = primaryMediaOf(o.occ, ctxOf({ occurrences: [a.occ, o.occ], modules: [a.module, o.module] }));
    expect(got).toMatchObject({ src: "/uploads/user/2026-08/pic.jpg", kind: "image" });
    expect(got.occ.id).toBe("a1");
    expect(got.module.id).toBe("m-a1");
  });

  it("passes an ABSOLUTE fileRef through unprefixed", () => {
    const a = artifact("a2", "https://cdn.example/p.png");
    const o = owner({ [F_MEDIA]: { value: "a2" } });
    const got = primaryMediaOf(o.occ, ctxOf({ occurrences: [a.occ, o.occ], modules: [a.module, o.module] }));
    expect(got.src).toBe("https://cdn.example/p.png");
  });

  it("returns null for a LEGACY STRING value — no silent passthrough", () => {
    const o = owner({ [F_MEDIA]: { value: "user/2026-08/pic.jpg" } });
    expect(primaryMediaOf(o.occ, ctxOf({ occurrences: [o.occ], modules: [o.module] }))).toBe(null);
  });

  it("returns null when the id names a NON-artifact occurrence", () => {
    const other = { id: "o-x", moduleId: "m-x", fields: {} };
    const mod = { id: "m-x", role: "instance" };
    const o = owner({ [F_MEDIA]: { value: "o-x" } });
    expect(primaryMediaOf(o.occ, ctxOf({ occurrences: [other, o.occ], modules: [mod, o.module] }))).toBe(null);
  });

  it("returns null with no media binding, no value, or no occurrence", () => {
    const bare = { module: { id: "m-b", fieldBindings: [] }, occ: { id: "o-b", moduleId: "m-b", fields: {} } };
    expect(primaryMediaOf(bare.occ, ctxOf({ occurrences: [bare.occ], modules: [bare.module] }))).toBe(null);
    const o = owner({});
    expect(primaryMediaOf(o.occ, ctxOf({ occurrences: [o.occ], modules: [o.module] }))).toBe(null);
    expect(primaryMediaOf(null, ctxOf())).toBe(null);
  });
});

describe("filesOf", () => {
  it("lists every Files pick, PRIMARY FIRST, deduped", () => {
    const a = artifact("a1", "one.jpg");
    const b = artifact("b1", "two.pdf", "pdf");
    const c = artifact("c1", "three.mp4", "video");
    const o = owner({
      [F_MEDIA]: { value: "b1" },
      [F_FILES]: { value: ["a1", "b1", "c1"] },
    });
    const got = filesOf(o.occ, ctxOf({
      occurrences: [a.occ, b.occ, c.occ, o.occ],
      modules: [a.module, b.module, c.module, o.module],
    }));
    expect(got.map(x => x.occ.id)).toEqual(["b1", "a1", "c1"]);
    expect(got.map(x => x.kind)).toEqual(["pdf", "image", "video"]);
    expect(got[0].isPrimary).toBe(true);
    expect(got[1].isPrimary).toBe(false);
  });

  it("includes the primary even when Files does not list it", () => {
    const a = artifact("a1", "one.jpg");
    const o = owner({ [F_MEDIA]: { value: "a1" }, [F_FILES]: { value: [] } });
    const got = filesOf(o.occ, ctxOf({ occurrences: [a.occ, o.occ], modules: [a.module, o.module] }));
    expect(got.map(x => x.occ.id)).toEqual(["a1"]);
  });

  it("skips ids that resolve to nothing rather than rendering a hole", () => {
    const a = artifact("a1", "one.jpg");
    const o = owner({ [F_FILES]: { value: ["a1", "gone", "also-gone"] } });
    const got = filesOf(o.occ, ctxOf({ occurrences: [a.occ, o.occ], modules: [a.module, o.module] }));
    expect(got.map(x => x.occ.id)).toEqual(["a1"]);
  });

  it("accepts a BARE array value (FieldRenderer unwraps {value,flow})", () => {
    const a = artifact("a1", "one.jpg");
    const o = owner({ [F_FILES]: ["a1"] });
    const got = filesOf(o.occ, ctxOf({ occurrences: [a.occ, o.occ], modules: [a.module, o.module] }));
    expect(got.map(x => x.occ.id)).toEqual(["a1"]);
  });

  it("accepts a SINGLE id (a Files field not yet multiSelect)", () => {
    const a = artifact("a1", "one.jpg");
    const o = owner({ [F_FILES]: { value: "a1" } });
    const got = filesOf(o.occ, ctxOf({ occurrences: [a.occ, o.occ], modules: [a.module, o.module] }));
    expect(got.map(x => x.occ.id)).toEqual(["a1"]);
  });

  // The Files field and children COEXIST (user, 2026-08-06): a container can
  // hold artifacts inside it AND attach others by reference.
  it("unions ATTACHED picks with artifacts living INSIDE the occurrence", () => {
    const a = artifact("a1", "attached.jpg");
    const c = artifact("c1", "inside.pdf", "pdf");
    const o = owner({ [F_FILES]: { value: ["a1"] } });
    o.occ.occurrences = ["c1"];
    const got = filesOf(o.occ, ctxOf({
      occurrences: [a.occ, c.occ, o.occ], modules: [a.module, c.module, o.module],
    }));
    expect(got.map(x => x.occ.id)).toEqual(["a1", "c1"]);
    expect(got.map(x => x.source)).toEqual(["field", "child"]);
  });

  it("keeps a container's NON-artifact children out of the spread", () => {
    const c = artifact("c1", "inside.jpg");
    const plain = { id: "kid", moduleId: "m-kid", fields: {} };
    const o = owner({});
    o.occ.occurrences = ["kid", "c1"];
    const got = filesOf(o.occ, ctxOf({
      occurrences: [c.occ, plain, o.occ],
      modules: [c.module, { id: "m-kid", role: "instance" }, o.module],
    }));
    expect(got.map(x => x.occ.id)).toEqual(["c1"]);
  });

  it("counts an artifact only ONCE when it is both attached and inside", () => {
    const a = artifact("a1", "both.jpg");
    const o = owner({ [F_FILES]: { value: ["a1"] } });
    o.occ.occurrences = ["a1"];
    const got = filesOf(o.occ, ctxOf({ occurrences: [a.occ, o.occ], modules: [a.module, o.module] }));
    expect(got.map(x => x.occ.id)).toEqual(["a1"]);
    expect(got[0].source).toBe("field");
  });

  it("returns [] for an occurrence with neither binding", () => {
    const bare = { module: { id: "m-b", fieldBindings: [] }, occ: { id: "o-b", moduleId: "m-b", fields: {} } };
    expect(filesOf(bare.occ, ctxOf({ occurrences: [bare.occ], modules: [bare.module] }))).toEqual([]);
    expect(filesOf(null, ctxOf())).toEqual([]);
  });
});

// ── Task 4b: `main` on the Files field wins over the media binding ──────────
//
// MEASURED BEFORE WRITING (2026-08-07): both live grids hold 213 occurrences
// with a Files value and ZERO with a `main`, so this is purely additive today —
// every real row still resolves through the media binding. These pin the order
// so it cannot be reversed, and pin the fallback so 213 live posters keep
// rendering.
describe("primaryMediaOf — main on Files beats the media binding", () => {
  it("prefers the file marked as main", () => {
    const face = artifact("art-main", "user/2026-08/face.jpg");
    const poster = artifact("art-poster", "user/2026-08/poster.jpg");
    const o = owner({
      [F_MEDIA]: { value: "art-poster" },
      [F_FILES]: { value: ["art-poster", "art-main"], main: "art-main" },
    });
    const got = primaryMediaOf(o.occ, ctxOf({
      occurrences: [o.occ, face.occ, poster.occ],
      modules: [o.module, face.module, poster.module],
    }));
    expect(got?.occ.id).toBe("art-main");
  });

  it("REGRESSION: with no main, the media binding still resolves", () => {
    // The 213-row case. If this ever fails, every poster on the grid went blank.
    const poster = artifact("art-poster", "user/2026-08/poster.jpg");
    const o = owner({
      [F_MEDIA]: { value: "art-poster" },
      [F_FILES]: { value: ["art-poster"] },
    });
    const got = primaryMediaOf(o.occ, ctxOf({
      occurrences: [o.occ, poster.occ],
      modules: [o.module, poster.module],
    }));
    expect(got?.occ.id).toBe("art-poster");
  });

  it("falls back when main names a file that is not attached", () => {
    // The invariant is broken in the data. Rather than resolve to a hole, the
    // lookup must behave as though no main were set.
    const poster = artifact("art-poster", "user/2026-08/poster.jpg");
    const o = owner({
      [F_MEDIA]: { value: "art-poster" },
      [F_FILES]: { value: ["art-poster"], main: "art-gone" },
    });
    const got = primaryMediaOf(o.occ, ctxOf({
      occurrences: [o.occ, poster.occ],
      modules: [o.module, poster.module],
    }));
    expect(got?.occ.id).toBe("art-poster");
  });

  it("falls back when main names something that is not an artifact", () => {
    const poster = artifact("art-poster", "user/2026-08/poster.jpg");
    const notArt = {
      module: { id: "m-plain", role: "instance", label: "Plain" },
      occ: { id: "plain-1", moduleId: "m-plain", fields: {} },
    };
    const o = owner({
      [F_MEDIA]: { value: "art-poster" },
      [F_FILES]: { value: ["art-poster", "plain-1"], main: "plain-1" },
    });
    const got = primaryMediaOf(o.occ, ctxOf({
      occurrences: [o.occ, poster.occ, notArt.occ],
      modules: [o.module, poster.module, notArt.module],
    }));
    expect(got?.occ.id).toBe("art-poster");
  });

  it("resolves a main even when there is no media binding at all", () => {
    const face = artifact("art-main", "user/2026-08/face.jpg");
    const o = owner({ [F_FILES]: { value: ["art-main"], main: "art-main" } }, { files: true });
    o.module.fieldBindings = [{ fieldId: F_FILES, role: "files" }];
    const got = primaryMediaOf(o.occ, ctxOf({
      occurrences: [o.occ, face.occ],
      modules: [o.module, face.module],
    }));
    expect(got?.occ.id).toBe("art-main");
  });
});
