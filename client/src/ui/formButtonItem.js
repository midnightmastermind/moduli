// ui/formButtonItem.js
// The container radial's "Add a form button…" item: asks what the button adds (through the app's own form window,
// never window.prompt — a headset panel never shows one), then helpers/formButton writes the button, its operation
// and the binding in one undo step.
import { SquarePlus } from "lucide-react";
import { addFormButton } from "../helpers/formButton";
import { operationsBridge } from "../state/bindSocketToStore";
import { requestOpenOperation } from "../helpers/buttonOperation";
import { toast } from "../state/notificationStore";

export function formButtonItem({ occurrence, module, getOccMap, getModMap, fieldsById, gridId, dispatch, socket }) {
  if (!occurrence?.id || !module?.id) return null;
  return {
    icon: SquarePlus,
    label: "Add a form button…",
    color: "bg-slate-700 hover:bg-slate-600",
    onClick: async () => {
      const ask = operationsBridge.requestUserInput;
      if (!ask) { toast.error("Can't ask here — open the grid in the app to add a form button"); return; }
      let answer;
      try {
        answer = await ask({
          form: true, title: "Add a form button", submitLabel: "Add",
          items: [{ key: "noun", label: "What does it add?", type: "text", required: true,
            help: "The button is named New <this>." }],
        });
      } catch { return; } // cancelled
      const noun = String(answer?.noun || "").trim();
      if (!noun) return;
      const plan = addFormButton({
        dispatch, socket, container: occurrence, containerModule: module, noun,
        occurrencesById: getOccMap?.() || {}, modulesById: getModMap?.() || {}, fieldsById: fieldsById || {}, gridId,
      });
      toast.success(`Added "${plan.field.meta.buttonLabel}" — its operation is in the Command Center`);
      requestOpenOperation(plan.operation.id);
    },
  };
}
