// A copy is another occurrence of the same module (2026-10-21). Renaming one
// placement of a SHARED module must write that occurrence's own label — writing
// the module would rename the template and every other copy. A module placed
// once is renamed itself, as before (the control).
import { describe, it, expect, vi, afterEach } from "vitest";
import { renameContainer, renameLeaf } from "../helpers/CommitHelpers";
import { setOccurrencesGetter, hasOtherPlacements, placementsByModule } from "../helpers/sharedModule";
import { buildRenameItem } from "../modules/pageCardRename";

const connected = () => ({ emit: vi.fn(), connected: true });
const emits = (socket) => socket.emit.mock.calls.map(([event, payload]) => ({ event, payload }));
const occs = [
  { id: "tpl", moduleId: "slot" }, { id: "day1", moduleId: "slot" }, { id: "day2", moduleId: "slot" },
  { id: "alone", moduleId: "single" },
];
afterEach(() => setOccurrencesGetter(null));

describe("sharedModule", () => {
  it("indexes placements by module and ignores trashed ones", () => {
    const by = placementsByModule([...occs, { id: "t", moduleId: "single", trashed: true }]);
    expect(by.get("slot")).toEqual(["tpl", "day1", "day2"]);
    expect(by.get("single")).toEqual(["alone"]);
  });
  it("answers whether another placement exists", () => {
    expect(hasOtherPlacements("slot", "day1", occs)).toBe(true);
    expect(hasOtherPlacements("single", "alone", occs)).toBe(false);
  });
});

describe("renaming a placement of a shared module", () => {
  it("a container writes its own label and leaves the module alone", () => {
    setOccurrencesGetter(() => occs);
    const socket = connected();
    renameContainer({ socket, module: { id: "slot", label: "7:00am" }, occurrence: { id: "day1" }, label: "Morning" });
    const out = emits(socket);
    expect(out.find((e) => e.event === "update_occurrence")?.payload.occurrence).toMatchObject({ id: "day1", label: "Morning" });
    expect(out.some((e) => e.event === "update_module")).toBe(false);
  });
  it("typing the module's own name back clears the placement's label", () => {
    setOccurrencesGetter(() => occs);
    const socket = connected();
    renameContainer({ socket, module: { id: "slot", label: "7:00am" }, occurrence: { id: "day1", label: "Morning" }, label: "7:00am" });
    expect(emits(socket).find((e) => e.event === "update_occurrence")?.payload.occurrence).toMatchObject({ id: "day1", label: null });
  });
  it("a row (renameLeaf) does the same", () => {
    setOccurrencesGetter(() => occs);
    const socket = connected();
    renameLeaf({ socket, module: { id: "slot", label: "Exercise" }, occurrence: { id: "day2" }, label: "Leg day" });
    const out = emits(socket);
    expect(out.find((e) => e.event === "update_occurrence")?.payload.occurrence).toMatchObject({ id: "day2", label: "Leg day" });
    expect(out.some((e) => e.event === "update_module")).toBe(false);
  });
  it("a page card does the same", () => {
    setOccurrencesGetter(() => occs);
    const socket = connected();
    const item = buildRenameItem({ module: { id: "slot", label: "Project: {ProjectName}" }, occurrence: { id: "day1" }, socket });
    item.commit("Project: Via Fluere");
    expect(emits(socket).find((e) => e.event === "update_occurrence")?.payload.occurrence).toMatchObject({ id: "day1", label: "Project: Via Fluere" });
  });
  it("CONTROL: a module placed once is renamed itself", () => {
    setOccurrencesGetter(() => occs);
    const socket = connected();
    renameContainer({ socket, module: { id: "single", label: "Stats" }, occurrence: { id: "alone" }, label: "Daily Stats" });
    expect(emits(socket).find((e) => e.event === "update_module")?.payload.module).toMatchObject({ id: "single", label: "Daily Stats" });
  });
});
