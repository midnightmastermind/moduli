// Redo is OFF (user, 2026-08-27: "can we disable redo for the moment and just
// keep undo — redo complicates things more atm").
//
// It is also demonstrably broken, which is what makes disabling it honest
// rather than a shortcut. Driven end to end on a live row:
//
//   toggle -> true     undo -> false (REVERTED)     redo -> false (NOT reapplied)
//
// and A/B'd against a build predating the undo-speed work, which produced the
// identical result — so it is a standing defect, not a regression from it.
//
// These pin that it is off in BOTH places it can be reached from, because
// hiding a button is not disabling a feature: Ctrl+Y calls the action directly.

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { REDO_ENABLED } from "../hooks/useUndoRedo";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(SRC, p), "utf8");

describe("redo is disabled", () => {
  it("the flag is off", () => {
    expect(REDO_ENABLED).toBe(false);
  });

  it("the ACTION refuses, not just the button", () => {
    // Ctrl+Y / Ctrl+Shift+Z call `redo` directly and never consult `canRedo`,
    // so a button-only gate leaves the feature fully reachable by keyboard.
    const src = read("hooks/useUndoRedo.js");
    const redoFn = src.slice(src.indexOf("const redo = useCallback"));
    expect(redoFn.slice(0, 200)).toContain("if (!REDO_ENABLED) return;");
  });

  it("`canRedo` is forced false, so every consumer agrees", () => {
    // App, Grid and the history panel all read it; gating at the source is what
    // stops one of them disagreeing.
    expect(read("hooks/useUndoRedo.js")).toContain("setCanRedo(REDO_ENABLED && canRedo)");
  });

  it("the history panel — the SECOND surface — is gated too", () => {
    expect(read("ui/TransactionHistory.jsx")).toContain("REDO_ENABLED && UNDO_REDO_ENABLED");
  });

  it("UNDO is untouched — the control", () => {
    // Without this, "disable redo" passing would also pass if undo were broken.
    const src = read("hooks/useUndoRedo.js");
    const undoFn = src.slice(src.indexOf("const undo = useCallback"));
    expect(undoFn.slice(0, 300)).not.toContain("REDO_ENABLED");
    expect(src).toContain("setCanUndo(canUndo)");
  });
});
