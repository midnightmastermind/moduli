# Layout Cascade Spec — drag-in view + nav + lock + drop rules per kind

**Date:** 2026-05-22 · **Task:** #36 · **Status:** ✅ All slices shipped (1-6). Drop rules (slice 7 / `dropAccepts` cfg) deferred until a concrete consumer needs them.

A CSS-cascade-style system that resolves layout/behaviour rules per occurrence kind+role at runtime, with per-level overrides. Pairs with task #38 (type review) — type-review documents the *what*; this spec documents the *resolver*.

## Problem the cascade solves

Today's behaviour is hardcoded:
- Folder pages always show Preview/Representation switcher + Preview default on drop (commit 34f89c63 hardcodes both).
- Canvas always shows Preview/Representation/Actual + Representation default on drop.
- Mind-map nodes default to Representation (per docket #2 — partial implementation).
- Pages in containers don't have a defined behaviour today (one component for page-as-container shipped via task #45, but no per-kind drop default).
- Drop rules + lock rules live in `behaviorMode/behavior` on the module (sortable/draggable/droppable) — fine for opt-in but no per-kind default.

The user wants ONE system that drives all of these via per-kind defaults + per-occurrence overrides + per-ancestor inheritance — like the existing style cascade (commit aa1b8fe0 / e4a34e04 / `helpers/StyleHelpers.js`).

## The rule shape

Per `(ROLE, KIND)` tuple:
```ts
{
  dragInView: "preview" | "representation" | "actual",    // when this kind receives a drop, the new occurrence renders as
  navOptions: Array<"preview" | "representation" | "actual">, // which switcher buttons appear; [] = no switcher
  navAllowChange: boolean,                                 // false = locked to dragInView (page-in-container case)
  dropAccepts: Array<RoleKind> | "*",                      // which child role+kind tuples this surface accepts
  locked: boolean,                                         // when true, children can't be dragged out of this surface
  showFieldsByDefault: boolean,                            // representation view: shows fields by default vs label+icon only
}
```

## Default rules (per kind)

| ROLE | KIND | dragInView | navOptions | navAllowChange | locked | showFieldsByDefault |
|---|---|---|---|---|---|---|
| page | folder | preview | [preview, representation] | true | false | true |
| page | board | actual | [preview, representation, actual] | true | false | true |
| page | doc | actual | [preview, representation, actual] | true | false | true |
| page | canvas | representation | [preview, representation, actual] | true | false | **false** |
| page | table | actual | [representation, actual] | true | false | true |
| container | list | actual | [actual] | true | false | true |
| container | doc | actual | [actual] | true | false | true |
| container | board | actual | [representation, actual] | true | false | true |
| container | canvas | representation | [preview, representation, actual] | true | false | false |
| container | table | actual | [actual] | true | false | true |
| instance | * | actual | [actual] | true | false | true |
| artifact | * | actual | [preview, actual] | true | false | true |
| textblock | * | actual | [actual] | true | false | true |

**Special hardcoded rule:**
- **Page in container or page** → `dragInView: "representation"`, `navAllowChange: false`. A page cannot switch views when nested. User direction: "we cant allow pages to switch so thats why its rules by type". This override wins over the per-kind default.
- **Page at top level (in a panel, not nested)** → always `dragInView: "actual"`, `navAllowChange: false`. The page IS the panel's content — switching to "preview" of a page would render itself as a thumbnail of itself, recursive nonsense.

## Cascade resolution

Same model as the style cascade. Levels (root → leaf):
1. **Built-in defaults** (the table above)
2. **Grid-level override** (`grid.meta.layoutCascadeDefaults`)
3. **Panel-level override** (`panelOcc.meta.layoutCascade`)
4. **Page-level override** (`pageOcc.meta.layoutCascade`)
5. **Container-level override** (`containerOcc.meta.layoutCascade`)
6. **Per-occurrence override** (`occurrence.meta.layoutCascadeOverride`)

Resolution rule: deeper levels override shallower for any rule they specify. Missing rules cascade through. Hardcoded rules (the special page-in-container case) trump all overrides.

## Helper API (mirrors StyleHelpers.js)

```js
// helpers/layoutCascade.js
export const DEFAULT_LAYOUT_BY_KIND = { /* the table above */ };

export function resolveLayoutCascade({ leafKind, leafRole, ancestorChain }) {
  // ancestorChain: ordered grid → ... → leafOccurrence
  // Returns: { resolved: {...rules...}, levels: [{kind, label, contribution}, ...] }
  // The levels array is used by the layout-cascade editor UI to render
  // an "Inherited cascade" stack (same UX StyleEditor uses).
}

export function buildLayoutCascadeContext({ leafOccurrence, occurrencesById, modulesById, grid }) {
  // Walks parent chain via buildParentMap reverse map (occurrences[]
  // authoritative) and buckets by role; returns the ctx shape
  // resolveLayoutCascade expects.
}
```

## UI plan

A `<LayoutCascadeEditor>` component (sibling to `<StyleEditor>`) rendered:
- In `ui/LayoutForm.jsx` for panel-level
- In `ui/commandCenter/GridSettingsTab.jsx` for grid-level
- In `ui/ContainerForm.jsx` for container-level
- In `ui/InstanceForm.jsx` for occurrence-level
- In `ui/HeaderDropdown` for per-occurrence overrides (next to FiltersSection / FieldVisibilitySection / SortSection)

The editor surfaces the rule shape via four controls:
1. **Drag-in view** — radio (preview / representation / actual)
2. **Nav options** — checkboxes for the 3 modes (uncheck all = no switcher)
3. **Locked** — switch
4. **Show fields by default** — switch (representation-only)
5. **Inheritance row** at top: read-only stack of ancestor contributions (matches StyleEditor)

## Drop-handler integration

When an occurrence is dropped into a target container/page, `dropHandlers.js` reads the target's resolved cascade and sets the new occurrence's view via `meta.viewMode = resolved.dragInView`. Today PreviewNode + ModuleEmbedNode read `meta.viewMode` and auto-route — so the change is one-line per drop site.

## Nav-switcher integration

`ui/ViewModeSwitcher.jsx` already reads `viewMode` from the occurrence. Add a prop `allowedModes: Array<"preview" | "representation" | "actual">` resolved from the cascade. Hide buttons not in the list. When `navAllowChange === false`, hide the switcher entirely.

## Lock-rule integration

Today `behavior.draggable` on a module controls draggability. The cascade's `locked` field, when true, sets `behavior.draggable = false` for ALL children of this surface (resolved per-occurrence). Wire into `useDragDrop` / dragSystem.

## Drop-rule integration

`dropAccepts` filters what `useDroppable` accepts at this surface. Defaults to `"*"` (anything); per-kind defaults can constrain (e.g. folder page might accept only page-role children).

## Implementation slices

1. **`helpers/layoutCascade.js` skeleton** — DEFAULT_LAYOUT_BY_KIND table + `resolveDefaultLayout`. **SHIPPED** (2026-05-22).
2. **Drop handler integration** — `resolveDropInViewMode` reads the destination's effective cascade; `stampDropViewMode` writes `meta.viewMode` on the new child. Wired into the shared `autoAppendOnDrop` helper so every site that uses it picks up the cascade automatically. **SHIPPED** (2026-05-22).
3. **Switcher integration** — `ViewModeSwitcher` accepts `allowedModes` + `allowChange` from the cascade. Hides entirely when `allowChange === false` or `allowedModes` is empty. **SHIPPED** (2026-05-22).
4. **Lock rule** — `isMoveBlockedByCascadeLock` in `helpers/layoutCascade.js` finds the outermost ancestor with own `meta.layoutCascade.locked === true` and rejects moves whose destination is outside that ancestor. Wired into `dropHandlers.handleInstanceDrop` (move branch only — copy/copylink exempt since the original stays in place). Sibling-container moves under the same locked page are still allowed; cross-page moves are blocked with a toast. **SHIPPED** (2026-05-23). 6 regression tests in `__tests__/layoutCascade.test.js`.
5. **`LayoutCascadeEditor` component** — mirror StyleEditor pattern. Editor (`ui/LayoutCascadeEditor.jsx`) + per-occurrence HeaderDropdown surface (`ui/LayoutCascadeSection.jsx`) wired into all five spec'd sites: `modules/ModuleContainer.jsx` / `modules/ModulePage.jsx` / `modules/ModulePanel.jsx` (HeaderDropdown per-occurrence), `ui/ContainerForm.jsx` (Style tab — `containerOcc.meta.layoutCascade`), `ui/InstanceForm.jsx` (Style tab — `instanceOcc.meta.layoutCascadeOverride`), `ui/LayoutForm.jsx` (panel Style tab — `panelOcc.meta.layoutCascade`), and `ui/commandCenter/GridSettingsTab.jsx` (grid-level — `grid.meta.layoutCascadeDefaults`). Editor renders the inheritance row plus per-rule controls (drag-in view radio, nav options checkboxes, allow-change/locked/show-fields switches, representation-field chip whitelist). **FULLY SHIPPED** (2026-05-23).
6. **Cascade walker** — `mergeLayoutRules`, `resolveLayoutCascade`, `buildLayoutCascadeContext`, `resolveEffectiveLayout`. Mirrors `resolveStyleCascade` (parent-map walk, role-bucketed ctx, layered overrides). **SHIPPED** (2026-05-22) with 20 regression tests.
7. **Per-occurrence + per-container + per-page + per-panel + per-grid override storage** — reads work via `meta.layoutCascade` / `meta.layoutCascadeOverride` / `grid.meta.layoutCascadeDefaults`. **SHIPPED** in the walker; writes pending the LayoutCascadeEditor UI.

Slices 1-3 + 6 + partial 5 ship with this spec. Slice 4 + the full Slice 5 editor remain.

## Pairs with

- Task #38 (type review) — refinements per kind, including which views make sense per kind
- Task #35 (Representation view merged with canvas pill) — provides the universal small-view that the cascade can opt into
- Task #45 (page-within-page) — needed for the page-in-container hardcoded rule to apply
- Task #34 (account split — done) — was completed without the cascade; account display fields are now per-account, which the cascade doesn't need to know about

## Open questions

- **Per-field-cascade vs per-kind-cascade** — today's StyleEditor has a kind-aware whitelist (STYLE_FIELDS_BY_KIND). Should the layout cascade also have per-kind field visibility? Probably yes for the navOptions list — folder pages should never show "actual" even if a user tries to set it. Hardcode the constraint per kind.
- **Migration** — existing PreviewNode/Canvas/Mindmap hardcodes need to migrate. Best to flip incrementally: ship the helper + drop integration, switch one site (folder-page) to consume the cascade, verify, then migrate the rest.
- **Performance** — cascade resolution per render of every occurrence card could be expensive. Memoize per occurrence via `useMemo` keyed by occurrence + parentMap version.
