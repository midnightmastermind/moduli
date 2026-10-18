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

import { fireEvent } from "@testing-library/react";
import { AmbiguousChoices } from "../ui/AssistantDrawer.jsx";

describe("Jonah asks which one", () => {
  const options = [
    { title: "Pomodoro Technique", description: "Time management method" },
    { title: "Pappa al pomodoro", description: "Italian soup" },
  ];
  it("lists each choice with its description", () => {
    const { container } = render(<AmbiguousChoices title="Pomodoro" options={options} onPick={() => {}} />);
    expect(container.textContent).toContain("Which one did you mean?");
    expect(container.textContent).toContain("Pomodoro Technique — Time management method");
    expect(container.querySelectorAll("button")).toHaveLength(2);
  });
  it("a pick hands back that exact choice", () => {
    const picked = [];
    const { getByText } = render(<AmbiguousChoices title="Pomodoro" options={options} onPick={(o) => picked.push(o.title)} />);
    fireEvent.click(getByText("Pappa al pomodoro"));
    expect(picked).toEqual(["Pappa al pomodoro"]);
  });
  it("without a handler the choices are shown but not clickable", () => {
    const { container } = render(<AmbiguousChoices title="Pomodoro" options={options} onPick={null} />);
    expect([...container.querySelectorAll("button")].every((b) => b.disabled)).toBe(true);
  });
});
