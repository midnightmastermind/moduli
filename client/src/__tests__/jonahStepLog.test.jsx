// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StepLog } from "../ui/AssistantDrawer.jsx";

describe("StepLog", () => {
  const items = [
    { text: "Reading your request", status: "run", at: 1000 },
    { text: "Found 1 problem — fixing", status: "warn", at: 4000 },
    { text: "Check passed: 1 page", status: "ok", at: 9000 },
  ];
  it("one line per step, marked by how it went, with seconds into the request", () => {
    const { container } = render(<StepLog items={items} startedAt={1000} />);
    const lines = [...container.querySelectorAll(".jonah-step")].map((l) => l.textContent);
    expect(lines).toEqual(["·Reading your request0s", "!Found 1 problem — fixing3s", "✓Check passed: 1 page8s"]);
  });
  it("a live log marks the step in progress", () => {
    const { container } = render(<StepLog items={[...items, { text: "Writing", status: "run", at: 9500 }]} startedAt={1000} live />);
    expect(container.querySelectorAll(".jonah-step--current")).toHaveLength(1);
    expect(container.querySelector(".jonah-step--current").textContent).toMatch(/^›Writing/);
  });
});
