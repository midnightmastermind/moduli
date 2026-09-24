// utils/uploadKinds — how an upload is classified.
import { describe, it, expect } from "vitest";
import { mimeToKind, viewFieldsForKind } from "../utils/uploadKinds.js";

describe("mimeToKind", () => {
  it("a calendar file is shown as-is (code), not opened in the note editor", () => {
    expect(mimeToKind("text/calendar", "Follow-up - virtual.ics")).toBe("code");
    expect(mimeToKind("application/octet-stream", "invite.ICS")).toBe("code");   // Windows often sends no calendar mime
    expect(viewFieldsForKind(mimeToKind("text/calendar", "x.ics")).viewType).toBe("code");
  });
  it("controls: media, pdf, code and plain notes are unchanged", () => {
    expect(mimeToKind("image/png", "a.png")).toBe("image");
    expect(mimeToKind("application/pdf", "a.pdf")).toBe("pdf");
    expect(mimeToKind("text/javascript", "a.js")).toBe("code");
    expect(mimeToKind("text/markdown", "notes.md")).toBe("markdown");
    expect(mimeToKind("text/plain", "notes.txt")).toBe("markdown");
  });
});
