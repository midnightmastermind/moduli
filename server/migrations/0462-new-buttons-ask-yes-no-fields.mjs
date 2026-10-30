// 0462 — the New … forms also offer the YES/NO fields their rows use (user, 2026-10-30: "the add task menu doesnt have
// completed as an addable field"). 0454 left booleans out ("a new item starts unticked anyway"); the user wants to
// be able to make a task already Completed. Same rule as 0454 (a field on ≥2 rows and ≥10% of the destination's
// rows, not hidden, not media/files/display, not already asked), each with an Include box; only buttons stay out.
import { offerRowFields } from "./0454-new-buttons-ask-row-fields.mjs";

export const id = "0462-new-buttons-ask-yes-no-fields";
export const describe = "New … button forms also offer the yes/no fields their rows use (Completed on New task).";
export const touches = ["operations"];

export async function up({ gridId, models, log, dryRun }) {
  return offerRowFields({ gridId, models, log, dryRun, skipTypes: new Set(["button"]) });
}
