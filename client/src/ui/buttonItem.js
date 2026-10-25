// ui/buttonItem.js
// The radial "Add a button…" item (containers, pages, panels, rows, doc textblocks): asks for the button's text (through the app's own form window, never
// window.prompt — a headset panel never shows one) and binds a new button field on the container. Nothing else: a
// button does nothing until an operation LISTENS to it with an On Button trigger on that field (user, 2026-10-25:
// "the button does nothing until we add a listener for it in the operations").
import { SquarePlus } from "lucide-react";
import { operationsBridge } from "../state/bindSocketToStore";
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
          items: [{ key: "label", label: "Button text", type: "text", required: true }],
        });
      } catch { return; } // cancelled
      const label = String(answer?.label || "").trim();
      if (!label) return;
      addButton({ dispatch, socket, containerModule: module, label, fieldsById, gridId: gridId || occurrence.gridId });
      toast.success(`Added "${label}" — give an operation an On Button trigger on it to make it do something`);
    },
  };
}

/** A button field bound on the container — one undo step. Returns the field. */
export function addButton({ dispatch, socket, containerModule, label, fieldsById, gridId }) {
  const field = { id: uid(), gridId: gridId || containerModule?.gridId, name: uniqueFieldName(fieldsById, label), type: "button", meta: { buttonLabel: label } };
  withAction("Added button", () => {
    CommitHelpers.createField({ dispatch, socket, field });
    CommitHelpers.updateModule({ dispatch, socket, module: {
      ...containerModule, fieldBindings: [...(containerModule?.fieldBindings || []), { fieldId: field.id, role: "input" }],
    }, emit: true });
  });
  return field;
}
