// modules/ModuleTextblock.jsx
// ============================================================================
// The renderer for role:"textblock" — a peer of ModuleInstance / ModuleContainer
// / ModulePage.
//
// A textblock renders in exactly three MEASURED contexts (poms grid, 1036 occs):
//   card   ~51   a container/page child, or a moduleEmbed in a doc
//   block  246   an `instanceTextblock` node in a doc body
//   inline 721   an `instanceTextblockInline` node in a doc body
//
// They have DISJOINT feature sets — only `block` carries the BoundBody field
// binding and the provisional lifecycle; only `card` has listCapRows; the link
// chip exists on `card` and `inline` but not `block`. So this component dispatches
// by CONTEXT and each context keeps its own features. A union renderer would
// silently GRANT features (field binding appearing on a card textblock, a lazy
// placeholder on an inline chip), which is exactly what "works exactly the same"
// forbids.
//
// The `card` context COMPOSES ModuleInstance rather than reimplementing its shell.
// That shell is shared with ArtifactCard and is not going away, so composing makes
// this routing change behaviour-identical by construction.
// ============================================================================
import React from "react";
import ModuleInstance from "./ModuleInstance.jsx";
import TextblockCard from "./TextblockCard.jsx";
import DocContent from "./DocContent.jsx";
import BoundBody from "./BoundBody.jsx";
import { resolveEditorBinding } from "../state/editorBindings.js";

export const TEXTBLOCK_CONTEXTS = ["card", "block", "inline"];

export default function ModuleTextblock({ context, occurrence, module, ...rest }) {
  if (!TEXTBLOCK_CONTEXTS.includes(context)) {
    // Fail loudly. A silent default would render the wrong feature set, which is
    // the failure mode this component exists to prevent.
    throw new Error(`ModuleTextblock: unknown textblock context "${context}"`);
  }
  if (!occurrence) return null;

  if (context === "card") {
    // `renderBody` is the ONLY prop supplied here. floatHandle in particular must
    // pass through: three of the five call sites set it and two deliberately do
    // not, so forcing it would change the handle treatment at those two.
    return (
      <ModuleInstance
        {...rest}
        occurrence={occurrence}
        module={module}
        renderBody={() => <TextblockCard occurrence={occurrence} module={module} />}
      />
    );
  }

  if (context === "block") {
    // The node view keeps every ProseMirror concern (NodeViewWrapper, getPos /
    // deleteNode, embedDeleteRegistry, the caret hand-off). This owns the BODY
    // only — which is where the field binding and the lazy editor live.
    const { lazy, dispatch, socket, onExitBlock, onDeleteBlock, onEmptyBlur } = rest;
    const bodyBinding = resolveEditorBinding({ occurrence, module, slot: "body" });
    const body = (
      <DocContent
        occurrence={occurrence}
        dispatch={dispatch}
        socket={socket}
        hideToolbar={true}
        lazy={lazy}
        onExitBlock={onExitBlock}
        onDeleteBlock={onDeleteBlock}
        onEmptyBlur={onEmptyBlur}
      />
    );
    return bodyBinding
      ? <BoundBody hostOccurrence={occurrence} binding={bodyBinding}>{body}</BoundBody>
      : body;
  }

  // `inline` is still owned by InstanceTextblockInlineNode. It uses no TipTap at
  // all (a contentEditable span written imperatively) and its chip is a second
  // implementation of TextblockCard's — reconciling those is its own change,
  // gated on the inline characterization tests staying green unmodified.
  throw new Error(`ModuleTextblock: context "${context}" is not routed here yet`);
}
