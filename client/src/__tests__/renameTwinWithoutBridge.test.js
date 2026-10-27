// A section renamed in a reader window (ReaderApp — the headset's book windows) renames its page too: the twin
// lookup reads the caller's own maps, since ReaderApp never fills operationsBridge (user, 2026-10-27: renamed
// "Uses" in VR, the shelf book kept the old name).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { operationsBridge } from "../state/bindSocketToStore";
import * as CommitHelpers from "../helpers/CommitHelpers";

const occs = {
  page: { id: "page", moduleId: "mp", occurrences: ["sec"] },
  sec: { id: "sec", moduleId: "ms", parentId: "page" },
};
const mods = { mp: { id: "mp", role: "page", label: "Uses" }, ms: { id: "ms", role: "container", label: "Uses" } };

describe("renaming a section in a reader window", () => {
  beforeEach(() => { operationsBridge.findOcc = null; operationsBridge.getLocalMod = null; });

  it("renames its same-named page with it, from the caller's own maps", () => {
    const socket = { emit: vi.fn(), connected: true };
    CommitHelpers.renameContainer({
      dispatch: vi.fn(), socket, module: mods.ms, occurrence: occs.sec, label: "Moduli Use cases",
      lookup: { getOcc: (id) => occs[id], getMod: (id) => mods[id] },
    });
    const labels = socket.emit.mock.calls.filter(([ev]) => ev === "update_module").map(([, p]) => [p.module?.id, p.module?.label]);
    expect(labels).toContainEqual(["mp", "Moduli Use cases"]);
    expect(labels).toContainEqual(["ms", "Moduli Use cases"]);
  });

  it("without the caller's maps (and no bridge) it renames only the section — the reported bug", () => {
    const socket = { emit: vi.fn(), connected: true };
    CommitHelpers.renameContainer({ dispatch: vi.fn(), socket, module: mods.ms, occurrence: occs.sec, label: "X" });
    const ids = socket.emit.mock.calls.filter(([ev]) => ev === "update_module").map(([, p]) => p.module?.id);
    expect(ids).toEqual(["ms"]);
  });
});
