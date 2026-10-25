// ui/formButtonItem.js
// The container radial's "Add a button…" item: asks for the button's text and what it does — add an item through a
// form (helpers/formButton builds the operation), or something else (a blank operation to build in the Command
// Center). Either way the button can run any operation; the form one is only a ready-made start (through the app's own form window,
// never window.prompt — a headset panel never shows one), then helpers/formButton writes the button, its operation
// and the binding in one undo step.
import { SquarePlus } from "lucide-react";
import { addFormButton } from "../helpers/formButton";
import { operationsBridge } from "../state/bindSocketToStore";
import { requestOpenOperation, makeButtonOperation } from "../helpers/buttonOperation";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { withAction } from "../helpers/actionScope";
import { uid } from "../uid";
import { uniqueFieldName } from "../helpers/fieldCategories";
import { toast } from "../state/notificationStore";

export function formButtonItem({ occurrence, module, getOccMap, getModMap, fieldsById, gridId, dispatch, socket }) {
  if (!occurrence?.id || !module?.id) return null;
  return {
    icon: SquarePlus,
    label: "Add a button…",
    color: "bg-slate-700 hover:bg-slate-600",
    onClick: async () => {
      const ask = operationsBridge.requestUserInput;
      if (!ask) { toast.error("Can't ask here — open the grid in the app to add a form button"); return; }
      let answer;
      try {
        answer = await ask({
          form: true, title: "Add a button", submitLabel: "Add",
          items: [
            { key: "label", label: "Button text", type: "text", required: true,
              help: "Also the name of the operation it runs." },
            { key: "does", label: "What it does", type: "select", required: true,
              options: [
                { value: "form", label: "Add an item here, asking with a form" },
                { value: "blank", label: "Something else — build its operation" },
              ] },
          ],
        });
      } catch { return; } // cancelled
      const label = String(answer?.label || "").trim();
      if (!label) return;
      if (answer?.does === "blank") {
        const op = addBlankButton({ dispatch, socket, containerModule: module, label, fieldsById, gridId });
        toast.success(`Added "${label}" — build what it does in the Command Center › Operations`);
        requestOpenOperation(op.id);
        return;
      }
      const plan = addFormButton({
        dispatch, socket, container: occurrence, containerModule: module, label,
        occurrencesById: getOccMap?.() || {}, modulesById: getModMap?.() || {}, fieldsById: fieldsById || {}, gridId,
      });
      toast.success(`Added "${plan.field.meta.buttonLabel}" — its operation is in the Command Center`);
      requestOpenOperation(plan.operation.id);
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
