// FieldSelect's optional `counts`: fields the rows carry come first and say how many — the chart
// editor's "Protein · 12" grouping, kept when its native <select> became the searchable picker.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";

let seen = null;
vi.mock("../ui/DestinationPicker.jsx", () => ({ default: (props) => { seen = props.options; return null; } }));
const { default: FieldSelect } = await import("../ui/FieldSelect.jsx");

const fields = [
  { id: "a", name: "Amount", type: "number" },
  { id: "b", name: "Board Category", type: "select" },
  { id: "z", name: "Zeta", type: "text" },
];

describe("FieldSelect counts", () => {
  it("fields on the rows first, each saying how many; the rest by name after", () => {
    render(<FieldSelect fields={fields} value={null} onChange={() => {}} counts={new Map([["z", 12], ["b", 1]])} />);
    expect(seen.map((o) => o.id)).toEqual(["b", "z", "a"]);
    expect(seen.find((o) => o.id === "z").hint).toBe("text · on 12 rows");
    expect(seen.find((o) => o.id === "b").hint).toBe("select · on 1 row");
    expect(seen.find((o) => o.id === "a").hint).toBe("number");
  });
  it("no counts: plain alphabetical, as before", () => {
    render(<FieldSelect fields={fields} value={null} onChange={() => {}} />);
    expect(seen.map((o) => o.id)).toEqual(["a", "b", "z"]);
  });
});
