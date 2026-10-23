// ui/exportMarkdownItem.js
// The radial "Export to Markdown" item, shared by containers, pages and rows (helpers/exportMarkdown does the work).
// Maps are read when clicked, so an always-mounted menu costs nothing until used.
import { FileDown } from "lucide-react";
import { occurrenceToMarkdown, downloadMarkdown } from "../helpers/exportMarkdown";
import { occurrenceDisplayLabel } from "../helpers/occurrenceLabel";
import { toast } from "../state/notificationStore";

export function exportMarkdownItem({ occurrence, module, getOccMap, getModMap, fieldsById }) {
  if (!occurrence?.id) return null;
  return {
    icon: FileDown,
    label: "Export to Markdown",
    color: "bg-slate-700 hover:bg-slate-600",
    onClick: () => {
      const occurrencesById = getOccMap?.() || {};
      const modulesById = getModMap?.() || {};
      const md = occurrenceToMarkdown(occurrence.id, { occurrencesById, modulesById, fieldsById: fieldsById || {} });
      const title = occurrenceDisplayLabel(occurrence, module || modulesById[occurrence.moduleId], "export");
      downloadMarkdown(md, title);
      toast.success(`Exported "${title}" to Markdown`);
    },
  };
}
