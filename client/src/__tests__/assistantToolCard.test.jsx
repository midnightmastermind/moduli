import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { renderToolBody } from "../ui/AssistantDrawer.jsx";

const text = (node) => render(<div>{node}</div>).container.textContent;

describe("Jonah tool card", () => {
  it("shows a summary's title and text after Done", () => {
    const t = text(renderToolBody("wikipedia_summary", {
      ok: true, title: "Pomodoro Technique",
      extract: "The Pomodoro Technique is a time management method.", url: "https://en.wikipedia.org/wiki/Pomodoro_Technique",
    }));
    expect(t).toMatch(/^✓ Done\./);
    expect(t).toContain("Pomodoro Technique");
    expect(t).toContain("is a time management method.");
    expect(t.indexOf("Done")).toBeLessThan(t.indexOf("time management"));
  });
  it("a plain ok result still reads Done", () => {
    expect(text(renderToolBody("apply_template", { ok: true, newOccurrenceIds: ["a", "b"] }))).toBe("✓ Done — 2 new items.");
  });
});
