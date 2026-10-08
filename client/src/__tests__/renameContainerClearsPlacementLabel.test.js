// A container's header shows `occurrence.label ?? module.label` — a per-placement
// label written by an operation (Trackers: Date-Prefix Labels writes "Today's …")
// WINS. Renaming wrote only the MODULE label, so on such a placement the rename
// visibly did nothing, and a stale op-written label could not be cleared from the
// UI at all (2026-10-08: the Emotions Wheel kept "Today's Emotions Wheel" after it
// left Trackers). A rename now writes the module label AND clears this placement's
// own label, as one undo step — the typed name is what shows.
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renameContainer } from "../helpers/CommitHelpers";

const connected = () => ({ emit: vi.fn(), connected: true });
const emits = (socket) => socket.emit.mock.calls.map(([event, payload]) => ({ event, payload }));

describe("renameContainer", () => {
  it("clears a placement's own label and renames the module, in one action", () => {
    const socket = connected();
    renameContainer({
      socket,
      module: { id: "m1", label: "Emotions Wheel", meta: { graph: {} } },
      occurrence: { id: "o1", label: "Today's Emotions Wheel" },
      label: "Emotions Wheel",
    });
    const out = emits(socket);
    const occ = out.find((e) => e.event === "update_occurrence");
    expect(occ?.payload.occurrence).toMatchObject({ id: "o1", label: null });
    // Same label as before: the module is not rewritten for nothing.
    expect(out.some((e) => e.event === "update_module")).toBe(false);
    expect(occ.payload.__actionId).toBeTruthy();
  });

  it("writes the module label and clears the placement label together", () => {
    const socket = connected();
    renameContainer({
      socket,
      module: { id: "m1", label: "Stats", meta: { keep: 1 } },
      occurrence: { id: "o1", label: "Today's Stats" },
      label: "Daily Stats",
    });
    const out = emits(socket);
    const mod = out.find((e) => e.event === "update_module");
    const occ = out.find((e) => e.event === "update_occurrence");
    expect(mod.payload.module).toMatchObject({ id: "m1", label: "Daily Stats", meta: { keep: 1 } });
    expect(occ.payload.occurrence).toMatchObject({ id: "o1", label: null });
    expect(mod.payload.__actionId).toBe(occ.payload.__actionId);
  });

  // THE CONTROL: a placement with no label of its own is renamed exactly as before.
  it("touches only the module when the placement has no label of its own", () => {
    const socket = connected();
    renameContainer({ socket, module: { id: "m1", label: "Old" }, occurrence: { id: "o1", label: null }, label: "New" });
    const out = emits(socket);
    expect(out.map((e) => e.event)).toEqual(["update_module"]);
    expect(out[0].payload.module.label).toBe("New");
  });

  it("refuses an empty name", () => {
    const socket = connected();
    renameContainer({ socket, module: { id: "m1", label: "Old" }, occurrence: { id: "o1", label: "X" }, label: "   " });
    expect(socket.emit).not.toHaveBeenCalled();
  });
});

describe("ModuleContainer renames through it", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../modules/ModuleContainer.jsx"), "utf-8");
  it("every label commit calls renameContainer", () => {
    expect((src.match(/CommitHelpers\.renameContainer\(/g) || []).length).toBe(3);
  });
  // A useCallback's deps array is evaluated at render, so reading containerOccurrence
  // before its `const` is a TDZ crash in every container (2026-09-29 shipped one).
  it("declares containerOccurrence before the callbacks that read it", () => {
    const decl = src.indexOf("const containerOccurrence = useGridActionsSelector");
    expect(decl).toBeGreaterThan(0);
    expect(decl).toBeLessThan(src.indexOf("const commitLabel = useCallback"));
    expect(decl).toBeLessThan(src.indexOf("const commitInlineLabel = useCallback"));
  });
  it("no label commit writes the module label directly any more", () => {
    expect(src).not.toMatch(/updateModule\(\{[^}]*module: \{ \.\.\.module, label: next/);
  });
});
