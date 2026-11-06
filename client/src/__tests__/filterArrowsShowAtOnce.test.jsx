// @vitest-environment jsdom
// The date arrows changed their label only once the filter write and everything it set off had run (0.4-0.6s on a
// phone at 4x, measured 2026-11-06). The new date shows at once; the write follows after the paint.
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import FilterNavWidget from "../ui/FilterNavWidgets";

afterEach(() => vi.useRealTimers());
const filter = { id: "flt", fieldId: "fD", timeUnit: "day" };
const fieldsById = { fD: { id: "fD", name: "Date", type: "date" } };
const label = () => screen.getByTitle("Pick date / range / multi / weeks / months").textContent;
const paint = async () => { await act(async () => { vi.advanceTimersByTime(40); }); };

describe("date arrows", () => {
  it("show the new date before the write, and write after the paint", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "requestAnimationFrame", "cancelAnimationFrame", "clearTimeout"] });
    const onNav = vi.fn();
    render(<FilterNavWidget filter={filter} navConfig={{ style: "arrows" }} value="2026-11-06" fieldsById={fieldsById} onNav={onNav} />);
    expect(label()).toContain("Nov 6");
    fireEvent.click(screen.getByRole("button", { name: "Next date" }));
    expect(label()).toContain("Nov 7");
    expect(onNav).not.toHaveBeenCalled();
    await paint();
    expect(onNav).toHaveBeenCalledWith("2026-11-07");
  });
  it("two quick taps step two days and write once", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "requestAnimationFrame", "cancelAnimationFrame", "clearTimeout"] });
    const onNav = vi.fn();
    render(<FilterNavWidget filter={filter} navConfig={{ style: "arrows" }} value="2026-11-06" fieldsById={fieldsById} onNav={onNav} />);
    const next = screen.getByRole("button", { name: "Next date" });
    fireEvent.click(next); fireEvent.click(next);
    expect(label()).toContain("Nov 8");
    await paint();
    expect(onNav).toHaveBeenCalledTimes(1);
    expect(onNav).toHaveBeenCalledWith("2026-11-08");
  });
  it("a value changed elsewhere after the write shows", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "requestAnimationFrame", "cancelAnimationFrame", "clearTimeout"] });
    const onNav = vi.fn();
    const { rerender } = render(<FilterNavWidget filter={filter} navConfig={{ style: "arrows" }} value="2026-11-06" fieldsById={fieldsById} onNav={onNav} />);
    fireEvent.click(screen.getByRole("button", { name: "Next date" }));
    await paint();
    rerender(<FilterNavWidget filter={filter} navConfig={{ style: "arrows" }} value="2026-11-07" fieldsById={fieldsById} onNav={onNav} />);
    rerender(<FilterNavWidget filter={filter} navConfig={{ style: "arrows" }} value="2026-11-20" fieldsById={fieldsById} onNav={onNav} />);
    expect(label()).toContain("Nov 20");
  });
});
