// ui/FieldBindingsSection.jsx
// ============================================================
// The HeaderDropdown wrapper around `FieldBindingsEditor`.
//
// A PAGE has no settings FORM — `ModulePage` puts everything in its header
// dropdown (Filters / Feed / Graph / Sort / Field visibility / View mode /
// Layout cascade), so a "Fields tab" has nowhere to live there. This is the
// same editor in the shape that surface already uses, which is why pages get
// field authoring without a second implementation.
//
// It takes the OCCURRENCE (what every other section here takes) and resolves
// the module itself, so call sites stay `<FieldBindingsSection occurrence={…} />`
// exactly like their neighbours.
// ============================================================

import React from "react";
import FieldBindingsEditor from "./FieldBindingsEditor.jsx";
import { useGridActions } from "../GridActionsContext";

export default function FieldBindingsSection({ occurrence }) {
  const { modulesById } = useGridActions();
  const module = occurrence?.moduleId ? modulesById?.[occurrence.moduleId] : null;
  if (!module) return null;

  return (
    <div className="border-t border-border px-3">
      <FieldBindingsEditor
        module={module}
        hint="Fields this page carries. Create or rename them in Command Center → Fields."
      />
    </div>
  );
}
