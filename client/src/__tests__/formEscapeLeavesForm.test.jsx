// One Escape while a dropdown inside a button's form was open closed the dropdown AND the whole form, losing
// everything typed (2026-11-04 UI sweep, measured on prod). The form already asked "is a popup open?" — but
// Radix closes its popover from a CAPTURE-phase document listener, so by the time the form's bubble-phase
// listener ran the popover was gone and the form cancelled. The form listens in the capture phase now, and
// it registers when the form opens — before any dropdown inside it — so it looks first.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import FormModal from "../ui/FormModal";

const request = { title: "Sweep form", items: [{ key: "a", label: "A", type: "text" }] };
let cleanupPopover = null;
afterEach(() => { cleanupPopover?.(); cleanupPopover = null; });

// What Radix does: a wrapper in the DOM, and a capture-phase Escape listener (added when the popover opens,
// i.e. AFTER the form) that removes it.
function openFakePopover() {
  const wrap = document.createElement("div");
  wrap.setAttribute("data-radix-popper-content-wrapper", "");
  document.body.appendChild(wrap);
  const onEsc = (e) => { if (e.key === "Escape") wrap.remove(); };
  document.addEventListener("keydown", onEsc, true);
  cleanupPopover = () => { document.removeEventListener("keydown", onEsc, true); wrap.remove(); };
}

describe("Escape inside a button's form", () => {
  it("closes an open dropdown and leaves the form open", () => {
    const onCancel = vi.fn();
    render(<FormModal request={request} onSubmit={vi.fn()} onCancel={onCancel} />);
    openFakePopover();
    act(() => { fireEvent.keyDown(document.body, { key: "Escape" }); });
    expect(document.querySelector("[data-radix-popper-content-wrapper]")).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("an open picker DIALOG (the address search) takes Escape before the form", () => {
    const onCancel = vi.fn();
    render(<FormModal request={request} onSubmit={vi.fn()} onCancel={onCancel} />);
    const dlg = document.createElement("div");
    dlg.setAttribute("role", "dialog"); dlg.setAttribute("aria-modal", "true");
    document.body.appendChild(dlg);
    const onEsc = (e) => { if (e.key === "Escape") dlg.remove(); };
    document.addEventListener("keydown", onEsc, true);
    cleanupPopover = () => { document.removeEventListener("keydown", onEsc, true); dlg.remove(); };
    act(() => { fireEvent.keyDown(document.body, { key: "Escape" }); });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("with nothing open, Escape cancels the form — the control", () => {
    const onCancel = vi.fn();
    render(<FormModal request={request} onSubmit={vi.fn()} onCancel={onCancel} />);
    act(() => { fireEvent.keyDown(document.body, { key: "Escape" }); });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
