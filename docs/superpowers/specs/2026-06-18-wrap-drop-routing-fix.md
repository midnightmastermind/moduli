# Spec: Wrap drag re-morph — fix drop ROUTING (the real bug behind "image won't move")

**Status:** ready for a fresh session. The line-level wrap-morph feature is built + merged on `feat/line-level-wrap-morph` (anchorOffset, detectSideHost side-everywhere, per-line highlight). This spec covers the ONE remaining bug: dragging a wrapped image to a new line does nothing (it cross-doc-moves instead of re-morphing).

## Evidence (live drop log, 2026-06-17/18)

Action: drag an image from the TOP of a textblock to the MIDDLE (full-width text), drop at `x:1266, y:762`. Source occ `cf4e4430` (role `artifact`, `sourceType: doc-embed`). Drop handled by editor `ed=6c94f267`. Log:

```
[detectSideHost] null — depth<1 { pos: 0 }
sideHost (wrap-beside detect) null
grouped-member? null
tryMove source NOT FOUND in this doc by occId cf4e4430
MOVE cross-doc insert → true
DETACH via embedDeleteRegistry { hasEntry: true }
```

## Diagnosis (root cause — NOT a detectSideHost logic bug)

- `posAtCoords({1266,762})` on editor `6c94f267` returned **pos 0** → `doc.resolve(0).depth < 1` → `detectSideHost` bails. pos 0 means the drop point is **not over `6c94f267`'s text content**.
- `grouped-member? null` → the image's `wrapGroup` is **NOT in `6c94f267`'s document**.
- `tryMove source NOT FOUND` → the image doesn't live in `6c94f267` either.
- Therefore: **the wrong editor is handling the drop.** `6c94f267` is some other/empty/overlapping editor that registered a Pragmatic-DnD drop target and caught the event; the image + its `wrapGroup` live in a DIFFERENT editor (the page). `detectSideHost` correctly finds no host because the editor it runs in genuinely has none. Every previous fix attempt failed because they all assumed the *right* editor was querying.
- `6c94f267` is PERSISTENT — it appears across many drop logs this session, always with `insertPos 0` and the source never found. So it's a specific, identifiable editor instance.

Existing guards that were supposed to prevent this (already in the build, insufficient):
- `client/src/ui/Editor.jsx` drop-target registration effect (~line 1256): skips registering when `el.parentElement.closest('.doc-editor')` exists (nested) OR `el.closest('.textblock-card, .instance-textblock-block, .table-td')` (sub-editor). `6c94f267` slips past both.
- `client/src/helpers/DragProvider.jsx handleDrop` (~line 1010): bails when the drop point is over a `.doc-editor` (so the monitor doesn't double-handle). This stops DragProvider, not the stray editor's own onDrop.

## Fix — two parts

### Part A (diagnose + close the registration gap)
1. **Identify `6c94f267`.** In `Editor.jsx`, at the TOP of the `dropTargetForElements` `onDrop` (and in the registration effect), log `occurrence?.id`, the resolved `module.role`/`module.kind` (look up via `occurrencesByIdRef`/`modulesByIdRef` from `occurrence.moduleId`), `mode` (doc/inline/cell), and the wrapper's ancestor classes (`el.closest('.textblock-card,.container-shell,.table-td,.wrap-group,.doc-editor')?.className`). One drop reveals what `6c94f267` is.
2. **Close the registration gap** so that editor stops registering as a top-level drop target. Likely additions to the guard: also skip when `mode === "inline"`, when the editor is a `role:"textblock"`/`kind:"doc"` *embed* sub-editor (check the occurrence's module role via the refs, not just DOM classes — DOM-class checks miss portal-rendered NodeViews), or when `el.closest('.wrap-group')` exists (a wrap host's own sub-editor must never own the drop; the PAGE editor that contains the `wrapGroup` node must).
3. **Acceptance:** after the fix, the same drag logs the drop firing on the PAGE editor (the one whose `findGroupMember` finds `cf4e4430`), NOT `6c94f267`.

### Part B (make the re-morph occurrence-driven, not coords-driven) — robustness
Even with Part A, a drop landing over the FLOAT (right side) can give `posAtCoords` → pos 0 (the point isn't over the prose). So the re-morph must not depend on `posAtCoords` finding the host.

1. **New registry** `client/src/docs/embedRegistry.js` (or a sibling): `wrapMemberRegistry: Map<occId, { editor, getPos }>` — `WrapGroupNode`/`ModuleEmbedNode` register each wrapGroup MEMBER (neighbor) occId → its owning editor + a `getPos` for the enclosing `wrapGroup`. (Mirror how `embedDeleteRegistry` already maps occId → deleteNode.)
2. **On drop of a wrapGroup neighbor** (the dragged occ is in `wrapMemberRegistry`): compute the new `anchorOffset` from the drop Y relative to THAT wrapGroup's host prose top (use `offsetFor` on the host's `.ProseMirror`, found via the registered editor's `nodeDOM(getPos())`), compute `side` from the drop X vs the host rect, and `editor.view.dispatch(setNodeMarkup(groupPos, { ...attrs, anchorOffset, side }))` on the REGISTERED editor. This re-morphs regardless of which editor caught the event.
3. **Acceptance:** dragging the image up/down its host moves the float to the dropped visual line (the `--wrap-mt` updates via `WrapGroupNode.measure`), and a drop on the left/right flips the side — with NO cross-doc insert + DETACH (the image stays in its wrapGroup).

## Files
- `client/src/ui/Editor.jsx` — registration guard (Part A), onDrop re-morph branch (Part B), diagnostic logs (remove after).
- `client/src/docs/embedRegistry.js` — add `wrapMemberRegistry` (Part B).
- `client/src/docs/WrapGroupNode.jsx` and/or `client/src/docs/ModuleEmbedNode.jsx` — register/unregister wrap members (Part B).
- Reuse: `client/src/docs/wrapAnchor.js` (`sideFromFrac`, `anchorOffsetForDrop`), the hoisted `offsetFor`/`detectSideHost` in `Editor.jsx`.

## Verify (manual — drag isn't unit-testable)
- Drag a wrapped image from top → middle → bottom of its host: the float lands at the dropped visual line each time; full-width prose above it, beside it, below it as appropriate. Console shows the drop handled by the page editor + a re-morph (no `MOVE cross-doc insert`, no `DETACH`).
- Drop on the opposite side → the float flips sides.
- A brand-new (unwrapped) image dropped beside a textblock still forms a fresh wrapGroup at the dropped line (the existing `wrapHostWithNeighbor`/`wrapMoveBeside` path, now reached because Part A routes to the right editor).
- `npm run build:client` clean; `npm run test --silent` → 1116 passing (no new unit tests needed; this is DnD glue — the pure helpers are already covered).

## Notes
- Keep the `[detectSideHost] null — <reason>` + `[detectSideHost] resolved` logs while implementing; remove them in the final commit.
- The persistent `6c94f267` is the smoking gun. Part A step 1 (log what it is) is ~10 minutes and unblocks everything; do it FIRST.
