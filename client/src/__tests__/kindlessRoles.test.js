// __tests__/kindlessRoles.test.js
//
// Nine client call sites hand `kind: "board"` to createModule for an INSTANCE.
// An instance has no sub-types and getModuleTypeIcon resolves kind before role,
// so each one draws the board icon and lands as an `inert-kind` integrity
// warning — migration 0003's defect, still being minted. Stripped at the
// chokepoint so a tenth call site cannot reintroduce it.
import { describe, it, expect } from "vitest";
import * as CommitHelpers from "../helpers/CommitHelpers";

function capture() {
  const emitted = [];
  const socket = { connected: true, emit: (ev, payload) => emitted.push([ev, payload]) };
  return { socket, emitted };
}

describe("createModule", () => {
  it("drops a kind on an instance", () => {
    const { socket, emitted } = capture();
    CommitHelpers.createModule({ dispatch: () => {}, socket, module: { id: "m1", role: "instance", kind: "board", label: "row" } });
    const [, payload] = emitted.find(([ev]) => ev === "create_module");
    expect(payload.module.kind).toBeUndefined();
    expect(payload.module.label).toBe("row");     // control: the rest survives
  });

  it("drops a kind on a panel", () => {
    const { socket, emitted } = capture();
    CommitHelpers.createModule({ dispatch: () => {}, socket, module: { id: "m2", role: "panel", kind: "board" } });
    const [, payload] = emitted.find(([ev]) => ev === "create_module");
    expect(payload.module.kind).toBeUndefined();
  });

  // The control that matters: a CONTAINER's kind is what routes its renderer.
  it("keeps a kind on a container", () => {
    const { socket, emitted } = capture();
    CommitHelpers.createModule({ dispatch: () => {}, socket, module: { id: "m3", role: "container", kind: "graph" } });
    const [, payload] = emitted.find(([ev]) => ev === "create_module");
    expect(payload.module.kind).toBe("graph");
  });
});
