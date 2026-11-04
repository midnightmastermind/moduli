// Phone: the rails get their own strips (the down rail lay over the last row's field pills), and the radial
// arc spaces its bigger 44px buttons so neighbours never overlap (user 2026-11-04).
import { describe, it, expect } from "vitest";
import { railInsetStyle } from "../mobile/MobileGridNav";
import { arcAngles, arcGeometry, ARC_ITEM_GAP, MOBILE_ARC_ITEM_PX } from "../ui/RadialMenu";

describe("railInsetStyle", () => {
  it("leaves room for every shown rail", () => {
    expect(railInsetStyle({ up: true, down: true, left: true, right: true })).toEqual({
      marginTop: 22, marginLeft: 26, height: "calc(100% - 44px)", width: "calc(100% - 52px)",
    });
  });
  it("a down rail alone shortens the viewport without moving it", () => {
    expect(railInsetStyle({ down: true })).toEqual({ marginTop: 0, marginLeft: 0, height: "calc(100% - 22px)", width: undefined });
  });
  it("no rails, no inset — the control", () => {
    expect(railInsetStyle({})).toEqual({ marginTop: 0, marginLeft: 0, height: undefined, width: undefined });
  });
});

describe("the phone arc", () => {
  it("neighbouring 44px buttons keep a gap", () => {
    const { itemPx, radius: base } = arcGeometry(42, true);
    expect(itemPx).toBe(MOBILE_ARC_ITEM_PX);
    for (const n of [3, 5, 8, 11]) {
      const { angles, radius } = arcAngles("down", n, base, itemPx);
      for (let i = 1; i < angles.length; i++) {
        const a = (angles[i - 1] * Math.PI) / 180, b = (angles[i] * Math.PI) / 180;
        const d = Math.hypot(Math.cos(a) - Math.cos(b), Math.sin(a) - Math.sin(b)) * radius;
        expect(d).toBeGreaterThanOrEqual(itemPx + ARC_ITEM_GAP - 0.01);
      }
    }
  });
  it("desktop geometry is unchanged — the control", () => {
    expect(arcGeometry(42, false)).toEqual({ itemPx: 28, radius: 42 });
  });
});
