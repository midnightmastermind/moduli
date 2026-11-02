import { describe, it, expect } from "vitest";
import { OFFLINE_SYSTEM_PROMPT, selectToolsForBackend } from "../services/assistantAgent.js";
import { moduliToolPack } from "../services/assistantTools.js";

// The local model gets a short prompt naming only the tools it is offered. A tool
// it is told about but not given makes it call nothing; one given but never named
// is read on every turn for nothing.
describe("the local model's prompt and tools agree", () => {
  const all = moduliToolPack({ baseUrl: "x", apiToken: "x", gridId: "g" });
  const offered = selectToolsForBackend(all, "ollama").map((t) => t.name).sort();
  const named = all.map((t) => t.name).filter((n) => new RegExp(`\\b${n}\\b`).test(OFFLINE_SYSTEM_PROMPT)).sort();

  it("names exactly the tools it is offered", () => {
    expect(named).toEqual(offered);
  });
  it("offers the one-step build tools", () => {
    expect(offered).toEqual(expect.arrayContaining(["create_board", "create_items", "add_filter"]));
  });
  it("stays short (it is read on CPU before every answer)", () => {
    const toolChars = selectToolsForBackend(all, "ollama")
      .reduce((n, t) => n + JSON.stringify({ name: t.name, description: t.description, parameters: t.input_schema }).length, 0);
    expect(OFFLINE_SYSTEM_PROMPT.length + toolChars).toBeLessThan(12000);
  });
  it("other backends keep the full catalog", () => {
    expect(selectToolsForBackend(all, "anthropic")).toHaveLength(all.length);
  });
});
