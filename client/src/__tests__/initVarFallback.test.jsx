// @vitest-environment jsdom
// INIT_VAR's fallback / fallback2 (tried when the value resolves empty) were read
// by the executor and written only by seeds: 9 poms ops use them. The step now
// shows both and writes them.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, fireEvent } from "@testing-library/react";
import { PipelineEditor } from "../blocks/OperationsBuilder";

const mk = (cfg) => ({ sources: [], steps: [{ id: "A", type: "action", config: { type: "INIT_VAR", name: "$goalPeriod", expr: "$goalItem._effectiveFilter.d", ...cfg } }] });
describe("INIT_VAR fallbacks", () => {
  it("shows stored fallbacks", () => {
    const { container } = render(<PipelineEditor pipeline={mk({ fallback: "$trigger.date", fallback2: "$today" })} onChange={vi.fn()} fields={[]} />);
    expect(container.querySelector('input[placeholder="fallback"]').value).toBe("$trigger.date");
    expect(container.querySelector('input[placeholder="fallback 2"]').value).toBe("$today");
  });
  it("writes a typed fallback and keeps the value", () => {
    const onChange = vi.fn();
    const { container } = render(<PipelineEditor pipeline={mk({})} onChange={onChange} fields={[]} />);
    fireEvent.change(container.querySelector('input[placeholder="fallback"]'), { target: { value: "$today" } });
    const cfg = onChange.mock.calls.at(-1)[0].steps[0].config;
    expect(cfg.fallback).toBe("$today");
    expect(cfg.expr).toBe("$goalItem._effectiveFilter.d");
  });
});
