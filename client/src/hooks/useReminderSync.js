// hooks/useReminderSync.js
// Keeps the Alarms list in step with Reminder field values (helpers/reminderSync.js). Runs a beat after
// the store settles, so a burst of writes is one plan. Every tab computes the same deterministic ids, so
// two tabs racing produce the same writes, never duplicates.
import { useEffect, useRef } from "react";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { planReminderOps } from "../helpers/reminderSync";

export function useReminderSync({ state, dispatch, socket, modulesById }) {
  const timer = useRef(null);
  const fields = state?.fields, occurrences = state?.occurrences, operations = state?.operations;
  const gridId = state?.gridId;
  const complete = !state?.awaitingDeferred;
  useEffect(() => {
    if (!gridId || !socket) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const { create, update, remove } = planReminderOps({
        fields: fields || [], occurrences: occurrences || [], operations: operations || [], modulesById: modulesById || {}, gridId, complete,
      });
      for (const operation of create) CommitHelpers.createOperation({ dispatch, socket, operation });
      for (const operation of update) CommitHelpers.updateOperation({ dispatch, socket, operation });
      for (const operationId of remove) CommitHelpers.deleteOperation({ dispatch, socket, operationId });
    }, 400);
    return () => clearTimeout(timer.current);
  }, [fields, occurrences, operations, modulesById, gridId, complete, socket, dispatch]);
}
