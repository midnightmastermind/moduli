// An operation's effects applied with NO user action open (a toolbar date step,
// a scheduler tick, another tab's echo) are the app's own bookkeeping. They used
// to mint one undo step per write ("Updated item") and stamp meta.userTouched —
// measured on prod 2026-10-18: one date step put every relabelled tracker tile on
// the undo stack. With an action open they must still join it (the control).
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { withAction, getActionId, runDerived, _resetActionScope } from "../helpers/actionScope";

const src = fs.readFileSync(path.join(__dirname, "../state/bindSocketToStore.js"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

beforeEach(() => _resetActionScope());

// The rule the effect loop applies, stated once so both arms are exercised.
const applyAs = (apply) => (getActionId() ? apply() : runDerived(apply));

describe("op effects outside a gesture are derived", () => {
  it("the effect loop routes through the rule", () => {
    expect(src).toMatch(/if \(getActionId\(\)\) applyAll\(\); else runDerived\(applyAll\);/);
  });

  it("no action open -> a write helper mints no action id", () => {
    const id = applyAs(() => withAction("Updated item", () => getActionId()));
    expect(id).toBeNull();
  });

  it("control: inside a gesture the writes join the gesture's action", () => {
    const [outer, inner] = withAction("Ticked", () => [getActionId(), applyAs(() => withAction("Updated item", () => getActionId()))]);
    expect(outer).toBeTruthy();
    expect(inner).toBe(outer);
  });
});
