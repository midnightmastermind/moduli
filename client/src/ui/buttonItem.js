// ui/buttonItem.js
// The container radial's "Add a button…" item: asks for the button's text (through the app's own form window, never
// window.prompt — a headset panel never shows one), binds a new button field on the container and gives it an empty
// operation, opened in the Command Center to build. What a button does is entirely its operation (user, 2026-10-25:
// "any button can do anything") — nothing here presets a job.
import { SquarePlus } from "lucide-react";
import { operationsBridge } from "../state/bindSocketToStore";
import { requestOpenOperation, makeButtonOperation } from "../helpers/buttonOperation";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { withAction } from "../helpers/actionScope";
import { uid } from "../uid";
import { uniqueFieldName } from "../helpers/fieldCategories";
import { toast } from "../state/notificationStore";

export function buttonItem({ occurrence, module, fieldsById, gridId, dispatch, socket }) {
  if (!occurrence?.id || !module?.id) return null;
  return {
    icon: SquarePlus,
    label: "Add a button…",
    color: "bg-slate-700 hover:bg-slate-600",
    onClick: async () => {
      const ask = operationsBridge.requestUserInput;
      if (!ask) { toast.error("Can't ask here — open the grid in the app to add a button"); return; }
      let answer;
      try {
        answer = await ask({
          form: true, title: "Add a button", submitLabel: "Add",
          items: [{ key: "label", label: "Button text", type: "text", required: true,
            help: "Also the name of the operation it runs." }],
        });
      } catch { return; } // cancelled
      const label = String(answer?.label || "").trim();
      if (!label) return;
      const op = addBlankButton({ dispatch, socket, containerModule: module, label, fieldsById, gridId });
      toast.success(`Added "${label}" — build what it does in Command Center › Operations`);
      requestOpenOperation(op.id);
    },
  };
}

/** A button bound on the container whose operation is empty (the user builds it) — one undo step. */
export function addBlankButton({ dispatch, socket, containerModule, label, fieldsById, gridId }) {
  const field = { id: uid(), gridId, name: uniqueFieldName(fieldsById, label), type: "button", meta: { buttonLabel: label } };
  const op = makeButtonOperation(field, { gridId });
  field.meta.operationId = op.id;
  withAction("Added button", () => {
    CommitHelpers.createField({ dispatch, socket, field });
    CommitHelpers.createOperation({ dispatch, socket, operation: op });
    CommitHelpers.updateModule({ dispatch, socket, module: {
      ...containerModule, fieldBindings: [...(containerModule?.fieldBindings || []), { fieldId: field.id, role: "input" }],
    }, emit: true });
  });
  return op;
}
