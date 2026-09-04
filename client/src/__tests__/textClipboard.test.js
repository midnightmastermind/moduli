// Cut / copy / paste for TEXT, shared by the prose menu and the input menu.
//
// The load-bearing case is the CONTROLLED-INPUT write. Every text control in
// this app is `value={state} onChange={e => setState(e.target.value)}`, so
// assigning `el.value` is discarded on the next render and `onChange` never
// fires — the paste looks like it worked and is silently lost. That is what
// most of this file pins.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  readClipboardText, writeClipboardText,
  inputSelection, setInputValue,
  cutFromInput, copyFromInput, pasteIntoInput,
  buildTextClipboardItems, isTextInputTarget, plainTextToProseContent,
} from "../helpers/textClipboard.js";

function makeInput(value, start, end, tag = "input") {
  const el = document.createElement(tag);
  document.body.appendChild(el);
  el.value = value;
  el.setSelectionRange(start, end ?? start);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
  // jsdom ships no clipboard; every test that needs one installs its own.
  delete navigator.clipboard;
});

describe("reading and writing the clipboard", () => {
  it("returns the text the clipboard holds", async () => {
    navigator.clipboard = { readText: async () => "hello" };
    expect(await readClipboardText()).toBe("hello");
  });

  // Firefox shows an ephemeral "Paste" prompt for cross-origin clipboard
  // content; DECLINING it rejects. A throw here must read as "nothing to
  // paste", never take the surface down with it.
  it("answers null when the read is refused, rather than throwing", async () => {
    navigator.clipboard = { readText: async () => { throw new Error("denied"); } };
    await expect(readClipboardText()).resolves.toBe(null);
  });

  it("answers null when the browser has no clipboard at all", async () => {
    expect(await readClipboardText()).toBe(null);
  });

  it("reports whether a write landed", async () => {
    const seen = [];
    navigator.clipboard = { writeText: async (t) => { seen.push(t); } };
    expect(await writeClipboardText("x")).toBe(true);
    expect(seen).toEqual(["x"]);

    navigator.clipboard = { writeText: async () => { throw new Error("nope"); } };
    expect(await writeClipboardText("x")).toBe(false);
  });
});

describe("reading an input's selection", () => {
  it("returns the selected slice", () => {
    const el = makeInput("hello world", 6, 11);
    expect(inputSelection(el)).toEqual({ start: 6, end: 11, text: "world" });
  });

  it("returns empty text for a collapsed caret", () => {
    const el = makeInput("hello", 2);
    expect(inputSelection(el).text).toBe("");
  });
});

// React installs an OWN `value` descriptor on each controlled input that caches
// what it has already seen, and decides from that cache whether an `input`
// event represents a real change. Without a stand-in for it, jsdom cannot tell
// `el.value = x` from the prototype setter — both dispatch, both look fine —
// so a test that only listens for the event is VACUOUS against the actual bug.
function installReactValueTracker(el) {
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  let lastSeen = proto.get.call(el);
  Object.defineProperty(el, "value", {
    configurable: true,
    get() { return proto.get.call(this); },
    set(v) { lastSeen = v; proto.set.call(this, v); },
  });
  // What React asks itself on every input event: "is this different from the
  // last value I handed out?" False here means onChange never runs.
  return { seesAChange: () => proto.get.call(el) !== lastSeen };
}

describe("writing an input's value", () => {
  it("bypasses React's value tracker, so the edit is seen as real", () => {
    const el = makeInput("abc", 3);
    const tracker = installReactValueTracker(el);
    setInputValue(el, "abcdef", 6);
    expect(tracker.seesAChange()).toBe(true);
  });

  // THE REGRESSION THIS FILE EXISTS FOR. `el.value = next` sets the DOM
  // property directly, which React's value tracker treats as already-seen —
  // so no `input` event is dispatched to its listeners and onChange never
  // runs. Going through the prototype's setter is what makes the write real.
  it("fires a bubbling input event so a controlled input hears it", () => {
    const el = makeInput("abc", 3);
    const heard = [];
    el.addEventListener("input", (e) => heard.push({ value: e.target.value, bubbles: e.bubbles }));
    setInputValue(el, "abcdef", 6);
    expect(heard).toEqual([{ value: "abcdef", bubbles: true }]);
  });

  it("places the caret where it is told", () => {
    const el = makeInput("abc", 3);
    setInputValue(el, "abcdef", 4);
    expect(el.selectionStart).toBe(4);
    expect(el.selectionEnd).toBe(4);
  });

  it("works on a textarea, not only an input", () => {
    const el = makeInput("abc", 3, 3, "textarea");
    const heard = [];
    el.addEventListener("input", () => heard.push(el.value));
    setInputValue(el, "abcd", 4);
    expect(heard).toEqual(["abcd"]);
  });
});

describe("cut, copy and paste on an input", () => {
  it("copy writes the selection and leaves the value alone", async () => {
    const el = makeInput("hello world", 6, 11);
    let written = null;
    navigator.clipboard = { writeText: async (t) => { written = t; } };
    await copyFromInput(el);
    expect(written).toBe("world");
    expect(el.value).toBe("hello world");
  });

  it("cut writes the selection AND removes it, caret at the seam", async () => {
    const el = makeInput("hello world", 5, 11);
    let written = null;
    navigator.clipboard = { writeText: async (t) => { written = t; } };
    const heard = [];
    el.addEventListener("input", () => heard.push(el.value));
    await cutFromInput(el);
    expect(written).toBe(" world");
    expect(el.value).toBe("hello");
    expect(el.selectionStart).toBe(5);
    expect(heard).toEqual(["hello"]);   // the app was told
  });

  it("cut with no selection does nothing at all", async () => {
    const el = makeInput("hello", 2);
    let written = null;
    navigator.clipboard = { writeText: async (t) => { written = t; } };
    const heard = [];
    el.addEventListener("input", () => heard.push(el.value));
    await cutFromInput(el);
    expect(written).toBe(null);
    expect(el.value).toBe("hello");
    expect(heard).toEqual([]);
  });

  it("paste REPLACES the selection and puts the caret after it", async () => {
    const el = makeInput("hello world", 6, 11);
    navigator.clipboard = { readText: async () => "there" };
    await pasteIntoInput(el);
    expect(el.value).toBe("hello there");
    expect(el.selectionStart).toBe(11);
  });

  it("paste at a collapsed caret inserts without eating anything", async () => {
    const el = makeInput("ac", 1);
    navigator.clipboard = { readText: async () => "b" };
    await pasteIntoInput(el);
    expect(el.value).toBe("abc");
    expect(el.selectionStart).toBe(2);
  });

  // A refused prompt must leave the field exactly as it was — not blank it.
  it("paste writes nothing when the clipboard read is refused", async () => {
    const el = makeInput("keep me", 0, 4);
    navigator.clipboard = { readText: async () => { throw new Error("denied"); } };
    const heard = [];
    el.addEventListener("input", () => heard.push(el.value));
    await pasteIntoInput(el);
    expect(el.value).toBe("keep me");
    expect(heard).toEqual([]);
  });
});

describe("the shared item list", () => {
  const noop = () => {};

  it("offers all three when there is a selection", () => {
    const items = buildTextClipboardItems({ hasSelection: true, onCut: noop, onCopy: noop, onPaste: noop });
    expect(items.filter(i => !i.separator).map(i => i.label)).toEqual(["Cut", "Copy", "Paste"]);
  });

  // A control that cannot act is worse than no control — there is nothing to
  // cut or copy with a collapsed caret, but pasting into one is legal.
  it("drops Cut and Copy when nothing is selected, and keeps Paste", () => {
    const items = buildTextClipboardItems({ hasSelection: false, onCut: noop, onCopy: noop, onPaste: noop });
    expect(items.filter(i => !i.separator).map(i => i.label)).toEqual(["Paste"]);
  });

  it("carries an icon and the caller's handler on every item", () => {
    const calls = [];
    const items = buildTextClipboardItems({
      hasSelection: true,
      onCut: () => calls.push("cut"),
      onCopy: () => calls.push("copy"),
      onPaste: () => calls.push("paste"),
    }).filter(i => !i.separator);
    items.forEach(i => expect(i.icon).toBeTruthy());
    items.forEach(i => i.onClick());
    expect(calls).toEqual(["cut", "copy", "paste"]);
  });

  it("ends with a separator so a host can append its own items", () => {
    const items = buildTextClipboardItems({ hasSelection: true, onCut: noop, onCopy: noop, onPaste: noop });
    expect(items[items.length - 1]).toEqual({ separator: true });
  });
});

// ── WHICH TARGETS GET OUR MENU ──────────────────────────────────────────────
describe("recognising a text control", () => {
  const input = (type) => { const el = document.createElement("input"); if (type) el.type = type; return el; };

  it("accepts a textarea and a plain input", () => {
    expect(isTextInputTarget(document.createElement("textarea"))).toBe(true);
    expect(isTextInputTarget(input())).toBe(true);
  });

  // A DENYLIST: anything not named here is treated as text, so a field that
  // starts rendering type="search" keeps working without an edit.
  it("accepts every text-ish type, including ones nobody listed", () => {
    for (const t of ["text", "search", "url", "email", "tel", "password", "number", "date"]) {
      expect(isTextInputTarget(input(t)), t).toBe(true);
    }
  });

  it("rejects the input types that are not text editing", () => {
    for (const t of ["checkbox", "radio", "button", "submit", "reset", "file", "image", "range", "color", "hidden"]) {
      expect(isTextInputTarget(input(t)), t).toBe(false);
    }
  });

  it("rejects a field you cannot type into", () => {
    const dis = input("text"); dis.disabled = true;
    const ro = input("text"); ro.readOnly = true;
    expect(isTextInputTarget(dis)).toBe(false);
    expect(isTextInputTarget(ro)).toBe(false);
  });

  // The doc editor is a contenteditable and owns its OWN menu (Bold, Convert
  // to instance…). Catching it here would delete that menu.
  it("rejects a contenteditable, so the prose menu survives", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    expect(isTextInputTarget(div)).toBe(false);
  });

  it("rejects nothing-at-all without throwing", () => {
    expect(isTextInputTarget(null)).toBe(false);
    expect(isTextInputTarget(document.createElement("div"))).toBe(false);
  });
});

// ── PASTING INTO PROSE ──────────────────────────────────────────────────────
describe("clipboard text as prose content", () => {
  // The footgun: TipTap parses a raw string as HTML, so plain text containing
  // markup characters would be swallowed instead of inserted.
  it("keeps markup as literal text, not parsed HTML", () => {
    expect(plainTextToProseContent("<div>hi</div>"))
      .toEqual({ type: "text", text: "<div>hi</div>" });
  });

  // A paragraph here would split the sentence you pasted into.
  it("stays INLINE for a single line", () => {
    expect(plainTextToProseContent("world")).toEqual({ type: "text", text: "world" });
  });

  // A ProseMirror text node cannot hold a newline at all.
  it("becomes paragraphs when the text has newlines", () => {
    expect(plainTextToProseContent("a\nb")).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "a" }] },
      { type: "paragraph", content: [{ type: "text", text: "b" }] },
    ]);
  });

  it("keeps a blank line as an empty paragraph rather than dropping it", () => {
    expect(plainTextToProseContent("a\n\nb")).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "a" }] },
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "b" }] },
    ]);
  });
});
