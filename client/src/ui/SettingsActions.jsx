// ui/SettingsActions.jsx
// The less-used things you can do to an occurrence (Convert, Export to Markdown, Add a button…, History, Apply Template), in its Settings instead of
// on the radial arc (user, 2026-11-05). Takes the same item objects a radial does. Settings closes first: Convert swaps the
// component this form sits in, and Add a button opens its own window.
import React from "react";
import { Clock, LayoutTemplate } from "lucide-react";

const CONVERT = "Convert";

/** Split an embed's radial items: its Convert entries (To pill, …) belong with the other Converts in Settings. */
export function splitConvertItems(items) {
  const list = (items || []).filter(Boolean);
  return { arc: list.filter((i) => i.group !== CONVERT), convert: list.filter((i) => i.group === CONVERT) };
}

/** Under "Convert to", "Convert to Textblock" and "To pill" read as the target alone. */
const targetName = (label) => { const n = label.replace(/^(Convert to|To) /, ""); return n[0].toUpperCase() + n.slice(1); };

/** What this block said on other days (ui/PastValuesDialog). */
export const historyItem = (open) => ({ icon: Clock, label: "History", onClick: () => open(true) });
/** onOpen takes the click's event: the templates menu opens where the button was. */
export const templateItem = (onOpen) => ({ icon: LayoutTemplate, label: "Apply Template", onClick: onOpen });

function ActionButton({ item, onClose }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-[12px] text-foreground hover:bg-muted"
      onClick={(e) => { onClose?.(); item.onClick?.(e); }}
    >
      {Icon ? <Icon size={13} aria-hidden="true" /> : null}
      {item.label}
    </button>
  );
}

export default function SettingsActions({ items, onClose }) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return null;
  // A Convert item may be one button with a submenu (containers) or several grouped ones (rows, an embed's To pill).
  const convert = list.flatMap((i) => (i.submenu ? i.submenu : i.group === CONVERT ? [i] : []));
  const rest = list.filter((i) => !i.submenu && i.group !== CONVERT);
  return (
    <div className="settings-actions mt-3 pt-2 border-t border-border space-y-2">
      {convert.length > 0 && (
        <div>
          <div className="text-[12px] font-semibold text-foreground/80 mb-1">Convert to</div>
          <div className="flex flex-wrap gap-1.5">
            {convert.map((i) => <ActionButton key={i.label} item={{ ...i, label: targetName(i.label) }} onClose={onClose} />)}
          </div>
        </div>
      )}
      {rest.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {rest.map((i) => <ActionButton key={i.label} item={i} onClose={onClose} />)}
        </div>
      )}
    </div>
  );
}
