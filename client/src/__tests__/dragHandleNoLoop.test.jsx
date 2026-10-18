// useDragDrop tracked its handle element with a layout effect that called setState after EVERY
// render, even when the element had not changed. Each such call is a synchronous re-render, so a
// board of hundreds of rows re-rendering during a search jump hit React's nested-update limit and
// the panel crashed (React #185). An unchanged handle must not cause an extra render.
import React, { useRef, useState } from "react";
import { describe, it, expect, vi } from "vitest";

window.matchMedia = window.matchMedia || vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
import { render, act } from "@testing-library/react";
import { useDragDrop } from "../helpers/dragSystem.js";

let renders = 0;
function Row({ tick }) {
  renders += 1;
  const handleRef = useRef(null);
  const { ref } = useDragDrop({ type: "instance", id: "r1", dragHandleRef: handleRef });
  return <div ref={ref} data-tick={tick}><span ref={handleRef}>h</span></div>;
}
let bump;
function Host() {
  const [tick, setTick] = useState(0);
  bump = () => setTick((t) => t + 1);
  return <Row tick={tick} />;
}

describe("useDragDrop handle tracking", () => {
  it("re-renders a row once per parent render, not twice", () => {
    render(<Host />);
    renders = 0;
    for (let i = 0; i < 5; i++) act(() => bump());
    expect(renders).toBe(5);
  });
});
