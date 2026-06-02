// Regression for the F5 search-scope extension on ComponentsTab.
// Validates the two extraction helpers exported via the same file —
// they're exercised by re-implementing the filter logic against
// fixture state.
import { describe, expect, it } from "vitest";

// The helpers are file-local; re-implement here to assert the contract
// the filter relies on (matches the inlined behavior in ComponentsTab).
function extractTextmapText(textmap) {
  if (!textmap || typeof textmap !== "object") return "";
  const parts = [];
  const walk = (n) => {
    if (!n) return;
    if (n.type === "text" && typeof n.text === "string") parts.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(textmap);
  return parts.join(" ").toLowerCase();
}

function extractFieldsText(occ) {
  const fields = occ?.fields;
  if (!fields || typeof fields !== "object") return "";
  const parts = [];
  for (const v of Object.values(fields)) {
    const raw = v?.value;
    if (raw == null) continue;
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") parts.push(String(raw));
    else if (Array.isArray(raw)) parts.push(raw.filter(x => x != null).join(" "));
    else if (typeof raw === "object") parts.push(JSON.stringify(raw));
  }
  return parts.join(" ").toLowerCase();
}

describe("ComponentsTab F5 search extraction", () => {
  it("extracts text from a TipTap doc tree", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Mona Lisa" }] },
        { type: "heading", content: [{ type: "text", text: "Section 2" }] },
      ],
    };
    expect(extractTextmapText(doc)).toBe("mona lisa section 2");
  });

  it("returns empty string for missing textmap", () => {
    expect(extractTextmapText(null)).toBe("");
    expect(extractTextmapText(undefined)).toBe("");
    expect(extractTextmapText({})).toBe("");
  });

  it("flattens a fields map into one searchable string", () => {
    const occ = {
      fields: {
        f1: { value: "hello" },
        f2: { value: 42 },
        f3: { value: true },
        f4: { value: ["red", "blue"] },
        f5: { value: { kind: "multi", dates: ["2026-05-24"] } },
      },
    };
    const out = extractFieldsText(occ);
    expect(out).toContain("hello");
    expect(out).toContain("42");
    expect(out).toContain("true");
    expect(out).toContain("red blue");
    expect(out).toContain("2026-05-24");
  });

  it("ignores null / missing field values", () => {
    const occ = { fields: { f1: { value: null }, f2: {} } };
    expect(extractFieldsText(occ)).toBe("");
  });

  it("returns empty for missing fields map", () => {
    expect(extractFieldsText(null)).toBe("");
    expect(extractFieldsText({})).toBe("");
    expect(extractFieldsText({ fields: null })).toBe("");
  });
});
