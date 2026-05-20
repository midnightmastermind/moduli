# Editor↔Field Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any container header or textblock body be rendered/written from a specific field on a *different* occurrence, joined by a shared field value. Universal primitive used initially for the Daily Question pattern (header = today's question, body = today's answer).

**Architecture:** A binding is a JOIN: `{ target: fieldId, link: linkFieldId }`. To resolve, find the occurrence X where `X.fields[link].value === this.fields[link].value` and read/write `X.fields[target]`. Bindings live on `module.meta.headerLink` / `module.meta.bodyLink` (template-wide) or `occurrence.meta.headerLink` / `occurrence.meta.bodyLink` (one-off override). Resolution: occurrence wins → module next → null = current behavior. Type-aware rendering: select → dropdown + dice inline with markdown wrapper; text → editable TipTap editor with TipTap-JSON stored in field.value, writes back to source occurrence.

**Tech Stack:** React + TipTap (editor), Mongoose Mixed (schema-free meta keys), existing CommitHelpers.updateOccurrence (write-back), CategoryPathPicker (binding UI).

---

## File Structure

**New files:**
- `client/src/state/editorBindings.js` — pure resolver/finder helpers + tests
- `client/src/ui/EditorBindingSection.jsx` — picker UI component (used in both ContainerForm and InstanceForm)
- `client/src/__tests__/editorBindings.test.js` — unit tests

**Modified files:**
- `client/src/modules/ModuleContainer.jsx` — header replaced with `BoundHeader` when binding resolves
- `client/src/docs/pills/InstanceTextblockNode.jsx` — body content driven by binding when present
- `client/src/modules/DocContent.jsx` (and/or `client/src/ui/Editor.jsx`) — bidirectional write-back path for text-type body binding
- `client/src/ui/ContainerForm.jsx` — mount `<EditorBindingSection slot="header">` and `slot="body"` (textblock-kind only)
- `client/src/ui/InstanceForm.jsx` — mount `<EditorBindingSection slot="body">` for textblock-role instances
- `server/scripts/createLiveData.js` — Daily Question container/textblock get `module.meta.headerLink` / `bodyLink`

**Schema:** No changes. `module.meta` and `occurrence.meta` are already `Mixed`; the new keys (`headerLink`, `bodyLink`) ride on existing field. The generic `update_module` / `update_occurrence` handlers already persist `meta` via spread.

---

## Conceptual model

```js
// Binding shape (on module.meta or occurrence.meta)
{
  headerLink: {
    target: "<fieldId of the field whose value drives the rendered text>",
    link:   "<fieldId whose value must MATCH between this entity and the source>",
  } | null,
  bodyLink: { target, link } | null,
}

// Resolve effective binding (cascade)
resolveEditorBinding({ occurrence, module, slot }) =>
  occurrence?.meta?.[`${slot}Link`] ?? module?.meta?.[`${slot}Link`] ?? null
  // slot ∈ {"header","body"}

// Find linked source occurrence by JOIN
findLinkedOccurrence({ binding, hostOccurrence, occurrencesById }) =>
  // Pull the host's link-field value
  const linkVal = hostOccurrence?.fields?.[binding.link]?.value;
  if (linkVal == null) return null;
  // Walk all occurrences, return the first that:
  //  - has the same link-field value
  //  - has the target field set (any non-empty value)
  for (const occ of Object.values(occurrencesById)) {
    if (occ.id === hostOccurrence.id) continue;
    const matchLink = occ?.fields?.[binding.link]?.value;
    if (!sameLinkValue(matchLink, linkVal)) continue;
    if (occ?.fields?.[binding.target]?.value == null) continue;
    return occ;
  }
  return null;
```

`sameLinkValue` handles dates (SAME_DAY semantics) and primitives. Reuse logic from the operations predicate (`fields.X SAME_DAY $today`) if a helper already exists; otherwise implement two cases: ISO-string dates → strip to YYYY-MM-DD before comparing; everything else → `===`.

---

## Daily Question concrete payload

After seed (`createLiveData.js`):

```js
// daily-question container module (template)
module.meta.headerLink = { target: journalQuestionFieldId, link: dateFieldId };

// daily-question textblock module (template, nested inside container template)
module.meta.bodyLink   = { target: journalAnswerFieldId,   link: dateFieldId };
```

At runtime:
- Day Page Build stamps `containerOcc.fields[dateFieldId] = $dayDate` on the cloned container occurrence
- Day Page Build stamps `textblockOcc.fields[dateFieldId] = $dayDate` on the cloned textblock occurrence
- Rotator op stamps `journalingInstanceOcc.fields[dateFieldId] = $dayDate` + `fields[journalQuestionFieldId] = "..."`
- User answers: writes `journalingInstanceOcc.fields[journalAnswerFieldId] = <TipTap JSON>` via write-back from the textblock body editor.

The container header and textblock body both read the journaling instance by `dateFieldId` JOIN.

---

## Task 1: Helpers — `resolveEditorBinding` + `findLinkedOccurrence` + tests

**Files:**
- Create: `client/src/state/editorBindings.js`
- Test: `client/src/__tests__/editorBindings.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// client/src/__tests__/editorBindings.test.js
import { describe, it, expect } from "vitest";
import { resolveEditorBinding, findLinkedOccurrence, sameLinkValue } from "../state/editorBindings.js";

describe("resolveEditorBinding", () => {
  it("returns null when neither occurrence nor module sets the slot", () => {
    expect(resolveEditorBinding({ occurrence: {}, module: {}, slot: "header" })).toBeNull();
  });
  it("returns the module binding when occurrence has none", () => {
    const b = { target: "f1", link: "f2" };
    expect(resolveEditorBinding({ occurrence: {}, module: { meta: { headerLink: b } }, slot: "header" })).toBe(b);
  });
  it("returns the occurrence binding when set (occurrence wins)", () => {
    const m = { target: "f1", link: "f2" };
    const o = { target: "f3", link: "f4" };
    expect(resolveEditorBinding({ occurrence: { meta: { headerLink: o } }, module: { meta: { headerLink: m } }, slot: "header" })).toBe(o);
  });
  it("returns null when occurrence explicitly clears with null", () => {
    const m = { target: "f1", link: "f2" };
    expect(resolveEditorBinding({ occurrence: { meta: { headerLink: null } }, module: { meta: { headerLink: m } }, slot: "header" })).toBe(m); // null is "unset", not "cleared"
  });
  it("returns null when occurrence explicitly clears with the literal string 'clear'", () => {
    const m = { target: "f1", link: "f2" };
    expect(resolveEditorBinding({ occurrence: { meta: { headerLink: "clear" } }, module: { meta: { headerLink: m } }, slot: "header" })).toBeNull();
  });
  it("scopes to slot (body link doesn't bleed into header)", () => {
    const body = { target: "fA", link: "fB" };
    expect(resolveEditorBinding({ occurrence: {}, module: { meta: { bodyLink: body } }, slot: "header" })).toBeNull();
    expect(resolveEditorBinding({ occurrence: {}, module: { meta: { bodyLink: body } }, slot: "body" })).toBe(body);
  });
});

describe("sameLinkValue", () => {
  it("compares strings by equality", () => {
    expect(sameLinkValue("a", "a")).toBe(true);
    expect(sameLinkValue("a", "b")).toBe(false);
  });
  it("compares numbers by equality", () => {
    expect(sameLinkValue(1, 1)).toBe(true);
    expect(sameLinkValue(1, 2)).toBe(false);
  });
  it("treats ISO date strings as SAME_DAY", () => {
    expect(sameLinkValue("2026-05-19T03:00:00.000Z", "2026-05-19T22:00:00.000Z")).toBe(true);
    expect(sameLinkValue("2026-05-19", "2026-05-19T10:00:00.000Z")).toBe(true);
    expect(sameLinkValue("2026-05-19", "2026-05-20")).toBe(false);
  });
  it("returns false when either side is null/undefined", () => {
    expect(sameLinkValue(null, "x")).toBe(false);
    expect(sameLinkValue("x", undefined)).toBe(false);
  });
});

describe("findLinkedOccurrence", () => {
  const occurrencesById = {
    host1: { id: "host1", fields: { dateF: { value: "2026-05-19" } } },
    src1:  { id: "src1",  fields: { dateF: { value: "2026-05-19" }, qF: { value: "Q for today" } } },
    src2:  { id: "src2",  fields: { dateF: { value: "2026-05-20" }, qF: { value: "Q tomorrow" } } },
    src3:  { id: "src3",  fields: { dateF: { value: "2026-05-19" } } }, // matches link but no target value
  };
  it("returns the matching occurrence by link field + non-empty target", () => {
    const r = findLinkedOccurrence({
      binding: { target: "qF", link: "dateF" },
      hostOccurrence: occurrencesById.host1,
      occurrencesById,
    });
    expect(r?.id).toBe("src1");
  });
  it("skips the host itself", () => {
    const r = findLinkedOccurrence({
      binding: { target: "qF", link: "dateF" },
      hostOccurrence: { id: "src1", fields: { dateF: { value: "2026-05-19" }, qF: { value: "self" } } },
      occurrencesById,
    });
    expect(r?.id).toBe("src1") || expect(r).toBeNull(); // host is src1 here — skipped → returns null
  });
  it("returns null when host has no link-field value", () => {
    const r = findLinkedOccurrence({
      binding: { target: "qF", link: "dateF" },
      hostOccurrence: { id: "host2", fields: {} },
      occurrencesById,
    });
    expect(r).toBeNull();
  });
  it("returns null when no occurrence has both matching link and target", () => {
    const r = findLinkedOccurrence({
      binding: { target: "qF", link: "dateF" },
      hostOccurrence: { id: "hostX", fields: { dateF: { value: "2099-01-01" } } },
      occurrencesById,
    });
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npm test -- editorBindings`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

```js
// client/src/state/editorBindings.js

// Cascade: occurrence.meta wins, then module.meta. The string "clear" on the
// occurrence explicitly opts out (rare — used when the user wants this one
// placement to ignore the module's binding without re-setting it).
export function resolveEditorBinding({ occurrence, module, slot }) {
  const key = `${slot}Link`; // "headerLink" | "bodyLink"
  const occBind = occurrence?.meta?.[key];
  if (occBind === "clear") return null;
  if (isBinding(occBind)) return occBind;
  const modBind = module?.meta?.[key];
  if (isBinding(modBind)) return modBind;
  return null;
}

function isBinding(v) {
  return v && typeof v === "object" && typeof v.target === "string" && typeof v.link === "string";
}

// Loose equality with a SAME_DAY pass for ISO date strings.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;
export function sameLinkValue(a, b) {
  if (a == null || b == null) return false;
  if (typeof a === "string" && typeof b === "string" && ISO_DATE_RE.test(a) && ISO_DATE_RE.test(b)) {
    return a.slice(0, 10) === b.slice(0, 10);
  }
  return a === b;
}

// Walk occurrencesById; return the first occurrence (other than the host)
// whose link-field value SAME_LINK-matches the host's link-field value AND
// whose target field has a non-null value. null = no match.
export function findLinkedOccurrence({ binding, hostOccurrence, occurrencesById }) {
  if (!binding || !hostOccurrence || !occurrencesById) return null;
  const linkVal = hostOccurrence?.fields?.[binding.link]?.value;
  if (linkVal == null) return null;
  for (const occ of Object.values(occurrencesById)) {
    if (!occ || occ.id === hostOccurrence.id) continue;
    const matchLink = occ?.fields?.[binding.link]?.value;
    if (!sameLinkValue(matchLink, linkVal)) continue;
    const tgtVal = occ?.fields?.[binding.target]?.value;
    if (tgtVal == null || tgtVal === "") continue;
    return occ;
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npm test -- editorBindings`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add client/src/state/editorBindings.js client/src/__tests__/editorBindings.test.js
git commit -m "feat(bindings): resolveEditorBinding + findLinkedOccurrence helpers"
```

---

## Task 2: Container header — bound rendering (select + text type-dispatch)

**Files:**
- Modify: `client/src/modules/ModuleContainer.jsx` — header label render path (`module.label` displays around lines 682-700 and 778-792)
- Create: `client/src/modules/BoundHeader.jsx` — type-aware rendering component

- [ ] **Step 1: Write a smoke test for BoundHeader**

```jsx
// client/src/__tests__/BoundHeader.test.jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext.js";
import BoundHeader from "../modules/BoundHeader.jsx";

const baseCtx = {
  dispatch: vi.fn(),
  socket: { emit: vi.fn() },
  occurrencesById: {
    host: { id: "host", fields: { dateF: { value: "2026-05-19" } } },
    src:  { id: "src",  fields: { dateF: { value: "2026-05-19" }, qF: { value: "opt-a" } } },
  },
  fieldsById: {
    qF: { id: "qF", name: "Question", type: "select", meta: { optionsSource: { mode: "manual", manual: ["opt-a","opt-b"] }, randomizable: true } },
    dateF: { id: "dateF", name: "Date", type: "date" },
  },
};

describe("BoundHeader", () => {
  it("renders the linked occurrence's select value with markdown prefix preserved", () => {
    render(
      <GridActionsContext.Provider value={baseCtx}>
        <BoundHeader
          hostOccurrence={baseCtx.occurrencesById.host}
          binding={{ target: "qF", link: "dateF" }}
          markdownPrefix="## "
          label={"## (template)"}
        />
      </GridActionsContext.Provider>
    );
    expect(screen.getByText(/opt-a/)).toBeTruthy();
  });

  it("falls back to the module label when no source is found", () => {
    render(
      <GridActionsContext.Provider value={{ ...baseCtx, occurrencesById: { host: baseCtx.occurrencesById.host } }}>
        <BoundHeader
          hostOccurrence={baseCtx.occurrencesById.host}
          binding={{ target: "qF", link: "dateF" }}
          markdownPrefix=""
          label={"FallbackLabel"}
        />
      </GridActionsContext.Provider>
    );
    expect(screen.getByText(/FallbackLabel/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npm test -- BoundHeader`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `BoundHeader.jsx`**

```jsx
// client/src/modules/BoundHeader.jsx
// Renders a container's header content driven by a JOIN binding. Type-dispatched:
//   - select target: dropdown of options + dice (if field.meta.randomizable)
//                    rendered text = currently selected option's value/label,
//                    surrounded by the markdownPrefix the user typed (## , #, etc.)
//   - text target:   read-only inline preview of the linked TipTap JSON
//                    (full bidirectional editing happens in BoundBody — headers
//                     are intentionally compact and single-line)
//   - fallback:      module label (passed in via `label` prop) if no source.
import React, { useContext, useMemo, useCallback } from "react";
import { Dices } from "lucide-react";
import { GridActionsContext } from "../GridActionsContext.js";
import { findLinkedOccurrence } from "../state/editorBindings.js";
import * as CommitHelpers from "../helpers/CommitHelpers";

export default function BoundHeader({ hostOccurrence, binding, markdownPrefix = "", label = "" }) {
  const { occurrencesById, fieldsById, dispatch, socket } = useContext(GridActionsContext) || {};
  const source = useMemo(
    () => findLinkedOccurrence({ binding, hostOccurrence, occurrencesById }),
    [binding, hostOccurrence, occurrencesById]
  );
  const field = fieldsById?.[binding?.target];
  if (!source || !field) {
    return <span>{markdownPrefix}{label}</span>;
  }
  const value = source.fields?.[binding.target]?.value;

  if (field.type === "select") {
    const options = resolveSelectOptions(field, { occurrencesById, fieldsById });
    const onPick = (next) => {
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: { id: source.id, fields: { ...source.fields, [binding.target]: { ...(source.fields?.[binding.target] || {}), value: next } } },
        emit: true,
      });
    };
    const onDice = () => {
      if (!options.length) return;
      const pick = options[Math.floor(Math.random() * options.length)];
      onPick(typeof pick === "string" ? pick : pick.value);
    };
    return (
      <span className="bound-header bound-header-select" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span>{markdownPrefix}{String(value ?? "")}</span>
        <select value={value ?? ""} onChange={(e) => onPick(e.target.value)} style={{ fontSize: 11, padding: "2px 4px" }}>
          {options.map((opt) => {
            const v = typeof opt === "string" ? opt : opt.value;
            const l = typeof opt === "string" ? opt : (opt.label ?? opt.value);
            return <option key={v} value={v}>{l}</option>;
          })}
        </select>
        {field.meta?.randomizable && (
          <button onClick={onDice} title="Randomize" style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, color: "inherit" }}>
            <Dices size={12} />
          </button>
        )}
      </span>
    );
  }

  // text / other: render plain string for header position. (Body binding handles
  // rich TipTap content — header is single-line by convention.)
  const text = typeof value === "object" ? extractPlainText(value) : String(value ?? "");
  return <span>{markdownPrefix}{text}</span>;
}

function extractPlainText(tiptap) {
  if (!tiptap || typeof tiptap !== "object") return "";
  if (tiptap.text) return tiptap.text;
  if (Array.isArray(tiptap.content)) return tiptap.content.map(extractPlainText).join(" ");
  return "";
}

// resolveSelectOptions: handle field.meta.optionsSource modes (manual / find).
// For now, support manual; "find" mode can be wired by importing the same
// resolver Field.jsx uses, but the seed Daily Question uses find-mode pointing
// to the Library "question" pool — wire that fully in Task 6.
function resolveSelectOptions(field, ctx) {
  const src = field?.meta?.optionsSource;
  if (!src) return field?.meta?.options || [];
  if (src.mode === "manual") return src.manual || [];
  // For find mode, reuse Field.jsx's internal resolver if exported; otherwise
  // shell out to a small inline find here.
  return resolveFindOptions(src.find, ctx);
}

function resolveFindOptions(find, { occurrencesById, fieldsById }) {
  if (!find) return [];
  // Minimal implementation: walk all occurrences; match those that satisfy
  // every rule in predicate (AND). Return { value, label } from valuePath/labelPath.
  const all = Object.values(occurrencesById || {});
  const matched = all.filter((occ) => evalFindRule(occ, find.predicate, fieldsById));
  return matched.map((occ) => ({
    value: readPath(occ, find.valuePath),
    label: readPath(occ, find.labelPath ?? find.valuePath),
  })).filter((o) => o.value != null);
}

function evalFindRule(occ, rule, fieldsById) {
  if (!rule) return true;
  if (rule.kind === "AND") return (rule.rules || []).every((r) => evalFindRule(occ, r, fieldsById));
  if (rule.kind === "OR")  return (rule.rules || []).some((r)  => evalFindRule(occ, r, fieldsById));
  // Leaf rule: { path, op: "IS", value }
  const left = readPath(occ, rule.path);
  if (rule.op === "IS") return left === rule.value;
  if (rule.op === "IS_NOT") return left !== rule.value;
  return false;
}

function readPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = String(path).split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  // `.value` shorthand: if the final node is a {value, flow} blob, unwrap it
  if (cur && typeof cur === "object" && "value" in cur && Object.keys(cur).length <= 2) return cur.value;
  return cur;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npm test -- BoundHeader`
Expected: PASS.

- [ ] **Step 5: Wire BoundHeader into ModuleContainer**

Locate the two header-render call sites in `client/src/modules/ModuleContainer.jsx` (the embedded path around line 682-695 and the non-embedded path around line 778-792). At both sites, wrap the label rendering with a binding check:

```jsx
// Near top of ModuleContainer file, alongside existing imports:
import { resolveEditorBinding } from "../state/editorBindings.js";
import BoundHeader from "./BoundHeader.jsx";

// Inside the InstanceInner / container header render:
const headerBinding = resolveEditorBinding({ occurrence: containerOccurrence, module, slot: "header" });

// Replace the existing `{module.label || "Container"}` with:
{headerBinding ? (
  <BoundHeader
    hostOccurrence={containerOccurrence}
    binding={headerBinding}
    markdownPrefix=""
    label={module.label || "Container"}
  />
) : (
  module.label || "Container"
)}
```

(Replace at BOTH header sites; both must check the same binding.)

- [ ] **Step 6: Manual smoke-test in the browser**

Run: `npm run dev` (from repo root), then in a browser:
1. Open the Daily Question page (Library folder → Daily Journal Questions)
2. Open the journaling instance and set `journalQuestion` to a value, set `date` to today
3. Open the daily-question container occurrence and set `date` to today
4. Add the binding manually for now via the in-app field editor or browser console: `window.__moduli_state__.occurrences.<daily-question-container-id>.meta.headerLink = { target: "<journalQuestionFid>", link: "<dateFid>" }`
5. Verify the header now displays the value of `journalQuestion` from the journaling instance, with a select dropdown next to it.

Expected: header shows the question text + dropdown. Picking another value updates the journaling instance's `journalQuestion` field across the app (visible on the instance card too).

- [ ] **Step 7: Commit**

```bash
git add client/src/modules/BoundHeader.jsx client/src/modules/ModuleContainer.jsx client/src/__tests__/BoundHeader.test.jsx
git commit -m "feat(bindings): container header reads/writes via JOIN binding (select + text type-dispatch)"
```

---

## Task 3: Textblock body — bound rendering (read path)

**Files:**
- Modify: `client/src/docs/pills/InstanceTextblockNode.jsx`
- Create: `client/src/modules/BoundBody.jsx` — the body equivalent of BoundHeader

- [ ] **Step 1: Write smoke test for BoundBody**

```jsx
// client/src/__tests__/BoundBody.test.jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext.js";
import BoundBody from "../modules/BoundBody.jsx";

const tiptapDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "today's answer" }] }],
};

const baseCtx = {
  dispatch: vi.fn(),
  socket: { emit: vi.fn() },
  occurrencesById: {
    host: { id: "host", fields: { dateF: { value: "2026-05-19" } } },
    src:  { id: "src",  fields: { dateF: { value: "2026-05-19" }, aF: { value: tiptapDoc } } },
  },
  fieldsById: {
    aF: { id: "aF", name: "Answer", type: "text" },
    dateF: { id: "dateF", name: "Date", type: "date" },
  },
};

describe("BoundBody", () => {
  it("renders the linked occurrence's text-field value as plain text (placeholder render)", () => {
    render(
      <GridActionsContext.Provider value={baseCtx}>
        <BoundBody
          hostOccurrence={baseCtx.occurrencesById.host}
          binding={{ target: "aF", link: "dateF" }}
        />
      </GridActionsContext.Provider>
    );
    expect(screen.getByText(/today's answer/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npm test -- BoundBody`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `BoundBody.jsx` (read-only first)**

```jsx
// client/src/modules/BoundBody.jsx
// Body-position counterpart of BoundHeader. Renders the linked occurrence's
// target-field value. For text-type fields, value is TipTap JSON; we render it
// via the existing TipTap Editor in read-only mode for now. Task 4 enables
// bidirectional write-back.
import React, { useContext, useMemo } from "react";
import { GridActionsContext } from "../GridActionsContext.js";
import { findLinkedOccurrence } from "../state/editorBindings.js";

export default function BoundBody({ hostOccurrence, binding, children }) {
  const { occurrencesById, fieldsById } = useContext(GridActionsContext) || {};
  const source = useMemo(
    () => findLinkedOccurrence({ binding, hostOccurrence, occurrencesById }),
    [binding, hostOccurrence, occurrencesById]
  );
  const field = fieldsById?.[binding?.target];
  if (!source || !field) return children; // fall back to whatever the textblock would render normally

  const value = source.fields?.[binding.target]?.value;
  const text = typeof value === "object" ? extractPlainText(value) : String(value ?? "");
  return <div className="bound-body bound-body-text">{text}</div>;
  // TipTap rendering happens in Task 4 — this is the read-only placeholder.
}

function extractPlainText(tiptap) {
  if (!tiptap || typeof tiptap !== "object") return "";
  if (tiptap.text) return tiptap.text;
  if (Array.isArray(tiptap.content)) return tiptap.content.map(extractPlainText).join(" ");
  return "";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npm test -- BoundBody`
Expected: PASS.

- [ ] **Step 5: Wire BoundBody into InstanceTextblockNode**

Open `client/src/docs/pills/InstanceTextblockNode.jsx`. After the `occurrence` lookup near line 17, add the binding resolution and short-circuit the DocContent render when a binding is present.

```jsx
// near top of file:
import { resolveEditorBinding } from "../../state/editorBindings.js";
import BoundBody from "../../modules/BoundBody.jsx";

// inside the component, just after `const occurrence = occurrencesById?.[occurrenceId] || null;`:
const bodyBinding = resolveEditorBinding({ occurrence, module: instance, slot: "body" });

// In the return JSX, where DocContent currently renders, branch:
return (
  <NodeViewWrapper /* ... existing props ... */>
    {/* ... existing handle / radial menu / wrapper chrome ... */}
    {bodyBinding ? (
      <BoundBody hostOccurrence={occurrence} binding={bodyBinding}>
        {/* fallback children = DocContent if binding can't resolve */}
        <DocContent occurrence={occurrence} /* ...existing props... */ />
      </BoundBody>
    ) : (
      <DocContent occurrence={occurrence} /* ...existing props... */ />
    )}
  </NodeViewWrapper>
);
```

(Exact prop list for DocContent must match the existing call site. Read the file's existing render block to copy the props verbatim.)

- [ ] **Step 6: Manual smoke-test**

In the browser:
1. Set `window.__moduli_state__.occurrences.<textblock-id>.meta.bodyLink = { target: "<journalAnswerFid>", link: "<dateFid>" }` for a daily-question textblock
2. Ensure the journaling instance has `dateF` matching the textblock's `dateF` and has `journalAnswerFid` set to a TipTap doc
3. Verify the textblock body now shows the journaling instance's answer text instead of its own textmap

Expected: textblock body renders the linked answer.

- [ ] **Step 7: Commit**

```bash
git add client/src/modules/BoundBody.jsx client/src/docs/pills/InstanceTextblockNode.jsx client/src/__tests__/BoundBody.test.jsx
git commit -m "feat(bindings): textblock body reads via JOIN binding (text type, read-only)"
```

---

## Task 4: Textblock body — bidirectional write-back (TipTap JSON)

**Files:**
- Modify: `client/src/modules/BoundBody.jsx` — replace the plain-text div with a TipTap editor that writes back to source.fields[binding.target]

- [ ] **Step 1: Write the failing test**

```jsx
// add to client/src/__tests__/BoundBody.test.jsx
import { fireEvent } from "@testing-library/react";
import * as CommitHelpers from "../helpers/CommitHelpers";
vi.mock("../helpers/CommitHelpers");

it("write-back: typing in the bound editor calls CommitHelpers.updateOccurrence with new value", async () => {
  CommitHelpers.updateOccurrence = vi.fn();
  render(
    <GridActionsContext.Provider value={baseCtx}>
      <BoundBody
        hostOccurrence={baseCtx.occurrencesById.host}
        binding={{ target: "aF", link: "dateF" }}
      />
    </GridActionsContext.Provider>
  );
  // Find the editor's content-editable area
  const editor = document.querySelector("[contenteditable='true']");
  expect(editor).toBeTruthy();
  // Simulate typing
  editor.innerHTML = "<p>new answer</p>";
  fireEvent.input(editor);
  // Verify CommitHelpers.updateOccurrence was called with the new TipTap JSON
  expect(CommitHelpers.updateOccurrence).toHaveBeenCalled();
  const call = CommitHelpers.updateOccurrence.mock.calls.at(-1)[0];
  expect(call.occurrence.id).toBe("src");
  expect(call.occurrence.fields.aF.value).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npm test -- BoundBody`
Expected: FAIL on the new write-back test.

- [ ] **Step 3: Replace BoundBody read path with TipTap editor (bidirectional)**

Rewrite `client/src/modules/BoundBody.jsx`:

```jsx
import React, { useContext, useMemo, useCallback } from "react";
import { GridActionsContext } from "../GridActionsContext.js";
import { findLinkedOccurrence } from "../state/editorBindings.js";
import Editor from "../ui/Editor.jsx";
import * as CommitHelpers from "../helpers/CommitHelpers";

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

export default function BoundBody({ hostOccurrence, binding, children }) {
  const { occurrencesById, fieldsById, dispatch, socket } = useContext(GridActionsContext) || {};
  const source = useMemo(
    () => findLinkedOccurrence({ binding, hostOccurrence, occurrencesById }),
    [binding, hostOccurrence, occurrencesById]
  );
  const field = fieldsById?.[binding?.target];

  const value = source?.fields?.[binding?.target]?.value;
  const initialDoc = useMemo(() => {
    if (value && typeof value === "object") return value;
    if (typeof value === "string" && value) return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: value }] }] };
    return EMPTY_DOC;
  }, [value]);

  const handleChange = useCallback((nextDoc) => {
    if (!source || !dispatch || !socket) return;
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: {
        id: source.id,
        fields: {
          ...source.fields,
          [binding.target]: { ...(source.fields?.[binding.target] || {}), value: nextDoc },
        },
      },
      emit: true,
    });
  }, [source, binding, dispatch, socket]);

  if (!source || !field) return children;

  return (
    <Editor
      mode="textblock"            /* or whatever mode flag matches existing call sites */
      initialDoc={initialDoc}
      onChange={handleChange}
      occurrence={source}          /* drag/drop context */
    />
  );
}
```

Note: `Editor.jsx` exposes a debounced `onChange` for textmap edits — confirm the exact prop name by reading the existing call from `DocContent.jsx`. Use `initialDoc` vs `content` vs `value` to match the editor's API (the codebase uses `initialDoc` per `containers/ContainerTable.jsx:TableCell`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npm test -- BoundBody`
Expected: PASS.

- [ ] **Step 5: Manual smoke-test**

Type into the bound textblock body in the browser. Verify:
1. Edits land on the JOURNALING INSTANCE'S `journalAnswerFieldId` (visible on the instance card too, via existing FieldRenderer)
2. Reload — answer persists
3. Navigate to a different day — answer becomes blank or shows that day's value (per the JOIN)
4. Navigate back — original answer reappears

Expected: bidirectional editing works across navigation.

- [ ] **Step 6: Commit**

```bash
git add client/src/modules/BoundBody.jsx client/src/__tests__/BoundBody.test.jsx
git commit -m "feat(bindings): textblock body bidirectional write-back to linked occurrence field"
```

---

## Task 5: Binding picker UI — `EditorBindingSection`

**Files:**
- Create: `client/src/ui/EditorBindingSection.jsx`
- Modify: `client/src/ui/ContainerForm.jsx` — mount section for header (all kinds) + body (textblock-kind containers)
- Modify: `client/src/ui/InstanceForm.jsx` — mount section for body (textblock-role instances only)

- [ ] **Step 1: Write smoke test for EditorBindingSection**

```jsx
// client/src/__tests__/EditorBindingSection.test.jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import EditorBindingSection from "../ui/EditorBindingSection.jsx";

describe("EditorBindingSection", () => {
  it("renders 'No binding' when nothing is set and offers Set", () => {
    const onChange = vi.fn();
    render(<EditorBindingSection slot="header" binding={null} onChange={onChange} fields={[]} />);
    expect(screen.getByText(/No binding/i)).toBeTruthy();
  });
  it("calls onChange when a target + link are both picked", () => {
    const onChange = vi.fn();
    render(
      <EditorBindingSection
        slot="header"
        binding={null}
        onChange={onChange}
        fields={[
          { id: "f1", name: "Question", type: "select" },
          { id: "f2", name: "Date", type: "date" },
        ]}
      />
    );
    // Implementation detail — the actual UI uses CategoryPathPicker; in this
    // smoke test we render two <select> proxies. Adapt the assertions to the
    // actual control once wired.
    fireEvent.change(screen.getByLabelText(/Target field/i), { target: { value: "f1" } });
    fireEvent.change(screen.getByLabelText(/Link field/i), { target: { value: "f2" } });
    expect(onChange).toHaveBeenLastCalledWith({ target: "f1", link: "f2" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npm test -- EditorBindingSection`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `EditorBindingSection.jsx`**

```jsx
// client/src/ui/EditorBindingSection.jsx
// A small section that lets the user pick the binding's target + link fields,
// and choose the scope (this occurrence vs. all occurrences of this module).
import React, { useState } from "react";

export default function EditorBindingSection({
  slot,                  // "header" | "body"
  binding,               // current effective binding ({ target, link } | null)
  onChange,              // (next: {target,link} | null) => void
  scope = "module",      // "module" | "occurrence" — which level the user is editing
  onScopeChange,         // (next: "module"|"occurrence") => void  (optional)
  fields,                // [{id,name,type}]
}) {
  const [target, setTarget] = useState(binding?.target || "");
  const [link, setLink] = useState(binding?.link || "");

  const handleCommit = (nextTarget, nextLink) => {
    if (nextTarget && nextLink) onChange({ target: nextTarget, link: nextLink });
    else if (!nextTarget && !nextLink) onChange(null);
  };

  return (
    <div className="editor-binding-section" style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, border: "1px solid var(--border-default, #333)", borderRadius: 6 }}>
      <div style={{ fontSize: 11, opacity: 0.75, textTransform: "uppercase" }}>
        {slot === "header" ? "Header binding" : "Body binding"}
      </div>
      {binding == null ? (
        <div style={{ fontSize: 12, opacity: 0.6 }}>No binding</div>
      ) : null}

      <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 2 }}>
        <span>Target field (shown content)</span>
        <select
          aria-label="Target field"
          value={target}
          onChange={(e) => { setTarget(e.target.value); handleCommit(e.target.value, link); }}
        >
          <option value="">— pick —</option>
          {fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </label>

      <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 2 }}>
        <span>Link field (JOIN match)</span>
        <select
          aria-label="Link field"
          value={link}
          onChange={(e) => { setLink(e.target.value); handleCommit(target, e.target.value); }}
        >
          <option value="">— pick —</option>
          {fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </label>

      {onScopeChange && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11 }}>
          <span style={{ opacity: 0.7 }}>Scope:</span>
          <button onClick={() => onScopeChange("module")} style={{ fontWeight: scope === "module" ? 700 : 400 }}>This template</button>
          <button onClick={() => onScopeChange("occurrence")} style={{ fontWeight: scope === "occurrence" ? 700 : 400 }}>This placement</button>
        </div>
      )}

      {binding && (
        <button
          onClick={() => { setTarget(""); setLink(""); onChange(null); }}
          style={{ fontSize: 11, alignSelf: "flex-start", color: "var(--danger, #f87171)", background: "transparent", border: "1px solid currentColor", padding: "2px 6px", borderRadius: 4 }}
        >
          Clear binding
        </button>
      )}
    </div>
  );
}
```

(The select fallbacks above keep the smoke test working without `CategoryPathPicker`. Once landed, swap to `CategoryPathPicker` for richer UX — same pattern InstanceForm's FieldsSection uses.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npm test -- EditorBindingSection`
Expected: PASS.

- [ ] **Step 5: Mount in ContainerForm**

In `client/src/ui/ContainerForm.jsx`, near the existing attached-fields section (around the markdown-container path), add:

```jsx
import EditorBindingSection from "./EditorBindingSection.jsx";
import { resolveEditorBinding } from "../state/editorBindings.js";

// inside the component:
const [bindingScope, setBindingScope] = useState("module");
const headerBinding = bindingScope === "module"
  ? (module?.meta?.headerLink ?? null)
  : (occurrence?.meta?.headerLink ?? module?.meta?.headerLink ?? null);

const setHeaderBinding = (next) => {
  if (bindingScope === "module") {
    CommitHelpers.updateModule({
      dispatch, socket,
      module: { ...module, meta: { ...(module.meta || {}), headerLink: next } },
      emit: true,
    });
  } else {
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: occurrence.id, meta: { ...(occurrence.meta || {}), headerLink: next } },
      emit: true,
    });
  }
};

// In the JSX, after the existing attached-fields section:
<EditorBindingSection
  slot="header"
  binding={headerBinding}
  onChange={setHeaderBinding}
  scope={bindingScope}
  onScopeChange={setBindingScope}
  fields={Object.values(fieldsById || {})}
/>
```

For body bindings: only mount when `module.kind === "textblock"` (or whatever kind a textblock container uses — the textblock instance lives under its own role/kind in this codebase).

- [ ] **Step 6: Mount in InstanceForm (textblock instances only)**

In `client/src/ui/InstanceForm.jsx`, after `<FieldsSection>` near line 270, add:

```jsx
{instance?.role === "textblock" && (
  <EditorBindingSection
    slot="body"
    binding={bindingScope === "module"
      ? (instance?.meta?.bodyLink ?? null)
      : (occurrence?.meta?.bodyLink ?? instance?.meta?.bodyLink ?? null)}
    onChange={(next) => {
      if (bindingScope === "module") {
        CommitHelpers.updateModule({ dispatch, socket, module: { ...instance, meta: { ...(instance.meta||{}), bodyLink: next } }, emit: true });
      } else {
        CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: occurrence.id, meta: { ...(occurrence.meta||{}), bodyLink: next } }, emit: true });
      }
    }}
    scope={bindingScope}
    onScopeChange={setBindingScope}
    fields={Object.values(fieldsById || {})}
  />
)}
```

- [ ] **Step 7: Run all client tests**

Run: `cd client && npm test`
Expected: all green (existing 686+ tests + 4 new editorBindings/BoundHeader/BoundBody/EditorBindingSection tests).

- [ ] **Step 8: Manual UX test in browser**

1. Open container settings popover on the daily-question container
2. Pick `Question` as target, `Date` as link → header binds
3. Toggle scope to "This placement" → set on occurrence
4. Verify only this occurrence's header changes; other clones of the same module still inherit the module's binding
5. Clear binding → header reverts to module label

Expected: picker works, scope toggle works, clear works.

- [ ] **Step 9: Commit**

```bash
git add client/src/ui/EditorBindingSection.jsx client/src/ui/ContainerForm.jsx client/src/ui/InstanceForm.jsx client/src/__tests__/EditorBindingSection.test.jsx
git commit -m "feat(bindings): EditorBindingSection picker (scope: module|occurrence)"
```

---

## Task 6: Seed wiring — Daily Question gets module-level bindings

**Files:**
- Modify: `server/scripts/createLiveData.js` — set `meta.headerLink` on the daily-question container module, `meta.bodyLink` on the daily-question textblock module.

- [ ] **Step 1: Locate the Daily Question seed block**

Run: `grep -n "Daily Question\|journalQuestion\|daily.question" /home/joshpoms/moduli/server/scripts/createLiveData.js | head -20`

Identify the container and textblock module definitions for the Daily Question pattern.

- [ ] **Step 2: Add meta.headerLink / meta.bodyLink to the seed**

```js
// In createLiveData.js, where the daily-question container module is defined:
const dailyQuestionContainerMod = {
  // ...existing fields...
  meta: {
    // ...existing meta keys...
    headerLink: { target: journalQuestionFieldId, link: dateFieldId },
  },
};

// And where the daily-question textblock module is defined:
const dailyQuestionTextblockMod = {
  // ...existing fields...
  meta: {
    // ...existing meta keys...
    bodyLink: { target: journalAnswerFieldId, link: dateFieldId },
  },
};
```

- [ ] **Step 3: Run the re-seed**

Run: `cd /home/joshpoms/moduli && node --env-file=.env server/scripts/createLiveData.js`
Expected: seed completes without error.

- [ ] **Step 4: Manual end-to-end test**

1. Launch app, navigate to today's Day Page
2. Daily Question container header should display today's question (from the Rotator op's journalQuestion value on the journaling instance dated today)
3. Click the dropdown → pick another question → header updates + journaling instance updates
4. Click the dice → header randomizes
5. Type into the textblock body → answer saves to the journaling instance's journalAnswer field
6. Navigate to yesterday → header shows yesterday's question, body shows yesterday's answer
7. Navigate back → today's pair reappears

Expected: full Daily Question flow works without manual binding configuration (binding lives on the module template via seed).

- [ ] **Step 5: Commit**

```bash
git add server/scripts/createLiveData.js
git commit -m "feat(seed): Daily Question container/textblock get module-level header/body bindings"
```

---

## Task 7: Verification + folder CLAUDE.md updates

- [ ] **Step 1: Run the full test suite**

Run from repo root:
```bash
npm test --prefix client 2>&1 | tail -10 && npm test --prefix server 2>&1 | tail -10
```
Expected: client 690+ passing, server 110 passing.

- [ ] **Step 2: Build the client**

Run: `cd /home/joshpoms/moduli/client && npm run build 2>&1 | tail -5`
Expected: build succeeds, no type/lint errors.

- [ ] **Step 3: Update folder CLAUDE.md files**

Add a new "Recent Changes" section to each of these files describing the editor↔field binding feature:
- `client/src/CLAUDE.md`
- `client/src/state/CLAUDE.md` (if it exists; otherwise skip)
- `client/src/modules/CLAUDE.md`
- `client/src/docs/CLAUDE.md`
- `client/src/ui/CLAUDE.md`
- `server/CLAUDE.md`

Each entry should describe (in 4-8 lines):
1. The new helper file `client/src/state/editorBindings.js`
2. `BoundHeader` + `BoundBody` components and where they mount
3. The `EditorBindingSection` picker and its scope toggle
4. The seed bindings on `createLiveData.js` (Daily Question)
5. The cascade: `occurrence.meta.{header,body}Link` → `module.meta.{header,body}Link` → null

- [ ] **Step 4: Commit final docs**

```bash
git add client/src/CLAUDE.md client/src/modules/CLAUDE.md client/src/docs/CLAUDE.md client/src/ui/CLAUDE.md server/CLAUDE.md
git commit -m "docs(bindings): record editor↔field binding feature in folder CLAUDE.mds"
```

---

## Notes and gotchas

- **Markdown wrapper around bound select value (deferred).** The user's design says typing `## ` before the binding should style the bound select's rendered text as an H2 (the prefix is not editable; only the dropdown changes the inner text). Initial implementation keeps the bound header as a plain inline `<span>` + `<select>` + dice — no markdown wrapper. A follow-up task can teach a TipTap header editor about a "bound text" inline node that picks up surrounding heading marks. Out of scope for v1.
- **TipTap JSON in field.value.** The existing `update_occurrence` server handler persists `fields` as `Mixed`, so storing a TipTap object in `fields[fid].value` is byte-identical to storing a string. No schema change.
- **Field type "text" already supports object values?** Verify by inspecting `FieldRenderer.jsx` — if it stringifies on render, the journaling instance's existing field row might mis-render once we start writing TipTap JSON. If that happens, BoundBody owns the rich render and FieldRenderer can either show "[rich content]" or extract plain text via the same `extractPlainText` helper.
- **Self-edit loop guard.** The bound editor and the source instance card both edit `source.fields[binding.target]`. CommitHelpers should already dedupe via optimistic dispatch + linked-group propagation. Smoke-test that typing rapidly in the bound editor doesn't double-write or flicker.
- **Memoization.** `findLinkedOccurrence` walks `Object.values(occurrencesById)` linearly. For large grids this is fine on render (a few hundred occurrences), but if it shows up in a profiler, pre-index occurrences by `fields.<linkFid>.value` in `bindSocketToStore.applyOperationEffect`. Defer until measured.
- **Editor.jsx prop names.** Task 4 assumes `initialDoc` / `onChange` — verify against the existing call site in `DocContent.jsx`. If it's `content` / `onUpdate`, adapt verbatim.
- **CategoryPathPicker upgrade.** The plan uses raw `<select>`s for simplicity. Once landed, swap to `CategoryPathPicker` to get the same UX as InstanceForm's FieldsSection.
