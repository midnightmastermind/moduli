import { describe, it, expect, vi } from "vitest";
import { assignLinkedGroup } from "../helpers/LayoutHelpers.js";

describe("assignLinkedGroup", () => {
  it("reuses the source's existing linkedGroupId", () => {
    const src = { id: "occ_1", linkedGroupId: "grp_existing" };
    const tag = vi.fn();
    const { linkedGroupId } = assignLinkedGroup(src, tag);
    expect(linkedGroupId).toBe("grp_existing");
    expect(tag).not.toHaveBeenCalled();
  });

  it("uses the source occurrence id as the group when untagged, and tags the source", () => {
    const src = { id: "occ_2" };
    const tag = vi.fn();
    const { linkedGroupId } = assignLinkedGroup(src, tag);
    expect(linkedGroupId).toBe("occ_2");
    expect(tag).toHaveBeenCalledWith("occ_2", "occ_2");
  });

  it("falls back to a generated id when there is no source occurrence", () => {
    const tag = vi.fn();
    const { linkedGroupId } = assignLinkedGroup(null, tag);
    expect(typeof linkedGroupId).toBe("string");
    expect(linkedGroupId.length).toBeGreaterThan(0);
    expect(tag).not.toHaveBeenCalled();
  });

  it("uses a provided {id} fallback object as the group and tags it", () => {
    const tag = vi.fn();
    const { linkedGroupId } = assignLinkedGroup({ id: "occ_fallback" }, tag);
    expect(linkedGroupId).toBe("occ_fallback");
    expect(tag).toHaveBeenCalledWith("occ_fallback", "occ_fallback");
  });
});
