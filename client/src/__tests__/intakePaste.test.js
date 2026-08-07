// Task 3 Step 4 — the PURE half of Ctrl+V intake.
//
// The veto (`shouldIgnorePaste`) carries more weight than the reader: this
// introduces a document-level listener on a key the user presses constantly,
// and getting it wrong does not lose a feature, it breaks typing. So most of
// these assert what intake must NOT touch.
import { describe, it, expect } from "vitest";
import { shouldIgnorePaste, readClipboardPayload, hasIntakeContent } from "../helpers/intakePaste";

const el = (html) => {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.firstElementChild;
};

describe("shouldIgnorePaste — what intake must keep its hands off", () => {
  it("ignores a paste into an input, textarea or select", () => {
    for (const tag of ["input", "textarea", "select"]) {
      expect(shouldIgnorePaste(document.createElement(tag)), tag).toBe(true);
    }
  });

  it("ignores a paste into a contenteditable", () => {
    const d = el(`<div contenteditable="true"></div>`);
    // jsdom does not implement isContentEditable, so the attribute path is what
    // actually runs here — which is also the path that matters in a browser for
    // a ProseMirror that is momentarily read-only.
    expect(shouldIgnorePaste(d)).toBe(true);
  });

  it("ignores a paste deep INSIDE editable text, not just on the editable root", () => {
    // The real target is nearly always a node buried in the doc, so a direct
    // check on the element would let every real paste through.
    const root = el(`<div class="ProseMirror" contenteditable="true"><p><span id="deep">x</span></p></div>`);
    document.body.appendChild(root);
    expect(shouldIgnorePaste(root.querySelector("#deep"))).toBe(true);
    root.remove();
  });

  // THE CASE THAT KILLED THE FIRST VERSION OF THIS RULE. A doc container
  // renders its body as a ProseMirror and embeds occurrence cards as NODE
  // VIEWS, so most of the visible grid lives inside an editor's DOM subtree.
  // A `closest(".ProseMirror")` veto rejected EVERY paste on the grid —
  // measured in a browser, all three probe cases bailed as "editable-target".
  // ProseMirror marks an atom node view contenteditable="false"; the nearest
  // explicit answer is the one that counts.
  it("CLAIMS a paste on a node view INSIDE a ProseMirror (a card, not text)", () => {
    const root = el(
      `<div class="ProseMirror" contenteditable="true">
         <div contenteditable="false" data-container-id="c1"><span id="card">card</span></div>
       </div>`,
    );
    document.body.appendChild(root);
    expect(shouldIgnorePaste(root.querySelector("#card"))).toBe(false);
    root.remove();
  });

  it("still ignores editable text nested BACK inside a node view", () => {
    // A node view can host its own editable sub-doc (a textblock card). The
    // nearest answer wins, so the caret's context is what decides.
    const root = el(
      `<div class="ProseMirror" contenteditable="true">
         <div contenteditable="false">
           <div contenteditable="true"><span id="inner">typing here</span></div>
         </div>
       </div>`,
    );
    document.body.appendChild(root);
    expect(shouldIgnorePaste(root.querySelector("#inner"))).toBe(true);
    root.remove();
  });

  it("CLAIMS a paste on ordinary grid chrome", () => {
    const board = el(`<div data-container-id="c1"><div id="row">row</div></div>`);
    document.body.appendChild(board);
    expect(shouldIgnorePaste(board.querySelector("#row"))).toBe(false);
    board.remove();
  });

  it("claims a paste with no element target at all (document/window)", () => {
    expect(shouldIgnorePaste(null)).toBe(false);
    expect(shouldIgnorePaste(document)).toBe(false);
  });
});

describe("readClipboardPayload", () => {
  const dt = ({ files = [], items = null, data = {} }) => ({
    files,
    items,
    getData: (t) => data[t] || "",
  });

  it("reads plain text, html and uri-list", () => {
    const p = readClipboardPayload(dt({ data: {
      "text/plain": "hello", "text/html": "<b>hello</b>", "text/uri-list": "https://x.test",
    } }));
    expect(p).toMatchObject({ text: "hello", html: "<b>hello</b>", url: "https://x.test" });
  });

  it("prefers FILES over the stray html a screenshot paste also carries", () => {
    // A pasted screenshot puts an image file AND a `<img>` tag on the clipboard.
    // Reading the text first would import the markup instead of the picture.
    const file = { name: "shot.png", type: "image/png", size: 10 };
    const p = readClipboardPayload(dt({ files: [file], data: { "text/html": "<img src='blob:x'>" } }));
    expect(p.files).toEqual([file]);
  });

  it("falls back to dt.items when dt.files is empty (the screenshot case)", () => {
    const file = { name: "shot.png", type: "image/png", size: 10 };
    const p = readClipboardPayload(dt({
      files: [],
      items: [{ kind: "file", getAsFile: () => file }, { kind: "string", getAsFile: () => null }],
    }));
    expect(p.files).toEqual([file]);
  });

  it("never throws on a hostile or half-implemented DataTransfer", () => {
    // Browsers restrict clipboard reads in ways that throw; a throw here would
    // kill the paste entirely rather than falling through to default behaviour.
    const hostile = {
      get files() { throw new Error("denied"); },
      getData() { throw new Error("denied"); },
    };
    expect(() => readClipboardPayload(hostile)).not.toThrow();
    expect(readClipboardPayload(hostile)).toEqual({ files: [], text: "", html: "", url: "" });
    expect(readClipboardPayload(null)).toEqual({ files: [], text: "", html: "", url: "" });
  });
});

describe("hasIntakeContent — the guard against asking about nothing", () => {
  it("is false for an empty or whitespace-only clipboard", () => {
    expect(hasIntakeContent(null)).toBe(false);
    expect(hasIntakeContent({ files: [], text: "", html: "", url: "" })).toBe(false);
    expect(hasIntakeContent({ files: [], text: "   \n ", html: "", url: "" })).toBe(false);
  });

  it("is true for files, text, html or a url", () => {
    expect(hasIntakeContent({ files: [{ name: "a" }] })).toBe(true);
    expect(hasIntakeContent({ text: "hi" })).toBe(true);
    expect(hasIntakeContent({ html: "<b>hi</b>" })).toBe(true);
    expect(hasIntakeContent({ url: "https://x.test" })).toBe(true);
  });
});
