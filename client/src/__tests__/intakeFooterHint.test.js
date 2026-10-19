import { describe, it, expect } from "vitest";
import { intakeFooterHint } from "../ui/IntakeSheet.jsx";

describe("intake sheet footer", () => {
  it("names keys on a keyboard", () => {
    expect(intakeFooterHint({})).toMatch(/Esc to cancel/);
    expect(intakeFooterHint({ followUp: true })).toMatch(/Esc to go back/);
  });
  it("names gestures on a touch screen, no keys", () => {
    expect(intakeFooterHint({ coarse: true })).toBe("Tap one · tap outside to cancel");
    expect(intakeFooterHint({ coarse: true, followUp: true })).not.toMatch(/Esc|↑↓/);
  });
});
