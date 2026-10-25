// @vitest-environment jsdom
// One runner for every button press: it names the pressed occurrence and its module, waits for a paused pipeline
// (a question / a form) to finish, and refuses a second press while the first is still running.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { buttonTransaction, runButtonOperation, useButtonRunner } from "../helpers/buttonRun.js";
import { operationsBridge } from "../state/bindSocketToStore.js";

const ctxFor = () => ({
  state: { grid: { _id: "g" }, modules: [], occurrences: [] },
  fieldsById: {}, operationsById: {}, occurrencesById: { occ1: { id: "occ1", moduleId: "mod1", fields: {} } },
  modulesById: { mod1: { id: "mod1", role: "instance", label: "Row" } }, dispatch: vi.fn(),
});
const askOp = { id: "op1", name: "Ask", enabled: true, triggerTypes: ["onButton"], triggerObjects: [{ eventType: "onButton" }],
  pipeline: { steps: [{ id: "s1", type: "action", config: { type: "GET_USER_INPUT", question: "Name?" } }] } };

afterEach(() => { operationsBridge.requestUserInput = null; });

describe("button runner", () => {
  it("names the pressed occurrence and its MODULE", () => {
    const t = buttonTransaction({ op: { id: "op1" }, hostOccurrence: { id: "occ1", moduleId: "mod1" }, fieldId: "f" });
    expect(t).toEqual({ type: "ButtonOp", operationId: "op1", occurrenceId: "occ1", instanceId: "mod1", fieldId: "f" });
  });

  it("resolves only after a paused pipeline finishes", async () => {
    let answer;
    operationsBridge.requestUserInput = () => new Promise((res) => { answer = res; });
    let done = false;
    const p = runButtonOperation({ op: askOp, hostOccurrence: { id: "occ1", moduleId: "mod1" }, fieldId: "f", ctx: ctxFor() })
      .then((r) => { done = true; return r; });
    await Promise.resolve(); await Promise.resolve();
    expect(done).toBe(false);
    answer("x");
    expect(await p).toEqual({ ran: true });
  });

  it("resolves { ran:false } for a missing operation", async () => {
    expect(await runButtonOperation({ op: null, hostOccurrence: { id: "occ1" }, ctx: ctxFor() })).toEqual({ ran: false, reason: "no operation" });
  });

  it("resolves (does not hang) when no input host is mounted", async () => {
    operationsBridge.requestUserInput = null;
    const r = await runButtonOperation({ op: askOp, hostOccurrence: { id: "occ1", moduleId: "mod1" }, ctx: ctxFor() });
    expect(r.ran).toBe(true);
  });

  it("useButtonRunner ignores a second press while the first is pending", async () => {
    let answer;
    const asks = vi.fn(() => new Promise((res) => { answer = res; }));
    operationsBridge.requestUserInput = asks;
    const { result } = renderHook(() => useButtonRunner());
    const args = { op: askOp, hostOccurrence: { id: "occ1", moduleId: "mod1" }, ctx: ctxFor() };
    let first;
    await act(async () => { first = result.current.run(args); });
    expect(result.current.busy).toBe(true);
    await act(async () => { result.current.run(args); });
    expect(asks).toHaveBeenCalledTimes(1);
    await act(async () => { answer("a"); await first; });
    expect(result.current.busy).toBe(false);
  });
});
