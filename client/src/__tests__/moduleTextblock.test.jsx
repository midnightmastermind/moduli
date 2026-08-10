// ModuleTextblock is the peer renderer for role:"textblock". It dispatches by
// CONTEXT, because the three contexts have disjoint feature sets and a union
// renderer would silently grant features (e.g. field binding on a card).
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ModuleTextblock from "../modules/ModuleTextblock.jsx";
import { planLeafRoleConversion } from "../helpers/convertOccurrence";

vi.mock("../modules/ModuleInstance.jsx", () => ({
  default: ({ renderBody, floatHandle, embedSourceType }) => (
    <div
      data-testid="shell"
      data-floathandle={floatHandle === undefined ? "absent" : String(!!floatHandle)}
      data-embedsource={embedSourceType || "none"}
    >
      {renderBody?.()}
    </div>
  ),
}));
vi.mock("../modules/TextblockCard.jsx", () => ({
  default: ({ occurrence }) => <div data-testid="card" data-occ={occurrence?.id} />,
}));
vi.mock("../modules/DocContent.jsx", () => ({
  default: ({ occurrence, lazy }) => (
    <div data-testid="doccontent" data-occ={occurrence?.id} data-lazy={String(!!lazy)} />
  ),
}));
vi.mock("../modules/BoundBody.jsx", () => ({
  default: ({ children, binding }) => (
    <div data-testid="boundbody" data-field={binding?.fieldId}>{children}</div>
  ),
}));

let blockBinding = null;
vi.mock("../state/editorBindings.js", () => ({
  resolveEditorBinding: () => blockBinding,
}));

const OCC = { id: "occ-1" };
const MOD = { id: "mod-1", role: "textblock", kind: "doc" };

beforeEach(() => { blockBinding = null; });

describe("ModuleTextblock — card context", () => {
  it("renders the card through the instance shell", () => {
    render(<ModuleTextblock context="card" occurrence={OCC} module={MOD} />);
    expect(screen.getByTestId("card")).toHaveAttribute("data-occ", "occ-1");
  });

  // The five call sites DISAGREE about floatHandle: three pass it, two do not.
  // Hardcoding it here would silently change two of them.
  it("passes floatHandle THROUGH rather than supplying it", () => {
    const { rerender } = render(<ModuleTextblock context="card" occurrence={OCC} module={MOD} />);
    expect(screen.getByTestId("shell")).toHaveAttribute("data-floathandle", "absent");
    rerender(<ModuleTextblock context="card" occurrence={OCC} module={MOD} floatHandle />);
    expect(screen.getByTestId("shell")).toHaveAttribute("data-floathandle", "true");
  });

  it("forwards the embed props the doc-embed site depends on", () => {
    render(<ModuleTextblock context="card" occurrence={OCC} module={MOD} embedSourceType="doc-embed" />);
    expect(screen.getByTestId("shell")).toHaveAttribute("data-embedsource", "doc-embed");
  });
});

describe("ModuleTextblock — block context", () => {
  it("renders DocContent alone when there is no body binding", () => {
    render(<ModuleTextblock context="block" occurrence={OCC} module={MOD} lazy />);
    expect(screen.getByTestId("doccontent")).toHaveAttribute("data-lazy", "true");
    expect(screen.queryByTestId("boundbody")).toBeNull();
  });

  it("wraps DocContent in BoundBody when a body binding resolves", () => {
    blockBinding = { fieldId: "f-answer", slot: "body" };
    render(<ModuleTextblock context="block" occurrence={OCC} module={MOD} />);
    expect(screen.getByTestId("boundbody")).toHaveAttribute("data-field", "f-answer");
    expect(screen.getByTestId("boundbody")).toContainElement(screen.getByTestId("doccontent"));
  });

  it("never renders the instance shell for the block context", () => {
    render(<ModuleTextblock context="block" occurrence={OCC} module={MOD} />);
    expect(screen.queryByTestId("shell")).toBeNull();
  });
});

describe("ModuleTextblock — contract", () => {
  it("throws on an unknown context rather than rendering something arbitrary", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<ModuleTextblock context="nonsense" occurrence={OCC} module={MOD} />))
      .toThrow(/unknown textblock context/i);
    spy.mockRestore();
  });

  it("renders nothing when the occurrence is missing, without throwing", () => {
    const { container } = render(<ModuleTextblock context="card" occurrence={null} module={MOD} />);
    expect(container).toBeEmptyDOMElement();
  });
});

// CONVERT now spans TWO renderers: a textblock renders here, an instance renders
// through ModuleInstance. The round trip used to be covered by construction and
// no longer is.
describe("instance <-> textblock conversion still round-trips across the split", () => {
  it("converts a textblock to an instance and back to the same role", () => {
    const mod = { id: "m1", role: "textblock", kind: "doc", label: "A block" };
    const occ = { id: "o1", textmap: { type: "doc", content: [] } };

    const toInstance = planLeafRoleConversion({ occurrence: occ, module: mod, targetRole: "instance" });
    expect(toInstance.modulePatch.role).toBe("instance");

    const back = planLeafRoleConversion({
      occurrence: occ,
      module: toInstance.modulePatch,
      targetRole: "textblock",
    });
    expect(back.modulePatch.role).toBe("textblock");
  });

  it("refuses a role outside CONVERTIBLE_LEAF_ROLES", () => {
    expect(planLeafRoleConversion({
      occurrence: { id: "o2" },
      module: { id: "m2", role: "textblock" },
      targetRole: "container",
    })).toBeNull();
  });
});
