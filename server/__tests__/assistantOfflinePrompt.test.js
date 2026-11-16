import { describe, it, expect } from "vitest";
import { OFFLINE_SYSTEM_PROMPT, selectToolsForBackend } from "../services/assistantAgent.js";
import { moduliToolPack } from "../services/assistantTools.js";

// The local model gets a short prompt naming only the tools it is offered. A tool
// it is told about but not given makes it call nothing; one given but never named
// is read on every turn for nothing.
describe("the local model's prompt and tools agree", () => {
  const all = moduliToolPack({ baseUrl: "x", apiToken: "x", gridId: "g" });
  const offered = selectToolsForBackend(all, "local").map((t) => t.name).sort();
  const named = all.map((t) => t.name).filter((n) => new RegExp(`\\b${n}\\b`).test(OFFLINE_SYSTEM_PROMPT)).sort();

  it("names exactly the tools it is offered", () => {
    expect(named).toEqual(offered);
  });
  it("offers the one-step build tools", () => {
    expect(offered).toEqual(expect.arrayContaining(["create_board", "create_items", "add_filter"]));
  });
  // Measured per kind of request — what each is actually OFFERED (toolsForModel), since `automate` is offered only to
  // an automation request and the one-row tools not to a page (2026-11-16).
  it("stays short (the prompt and tools are read before every answer)", async () => {
    const { toolsForModel } = await import("../services/assistantAgent.js");
    const local = selectToolsForBackend(all, "local");
    const size = (ts) => OFFLINE_SYSTEM_PROMPT.length + ts.reduce((n, t) => n + JSON.stringify({ name: t.name, description: t.description, parameters: t.input_schema }).length, 0);
    for (const [which, text] of [["build", "Add my CPS classes"], ["build", "Make a doc page called Home"], ["build", "remind me every day at 2pm to drink water"], ["fast", "what is on my schedule?"]]) {
      expect(size(toolsForModel(local, which, text)), text).toBeLessThan(12000);
    }
    expect(toolsForModel(local, "build", "remind me every day at 2pm").map((t) => t.name)).toContain("automate");
    expect(toolsForModel(local, "build", "Add my CPS classes").map((t) => t.name)).not.toContain("automate");
  });
  it("other backends keep the full catalog", () => {
    expect(selectToolsForBackend(all, "anthropic")).toHaveLength(all.length);
  });
});
