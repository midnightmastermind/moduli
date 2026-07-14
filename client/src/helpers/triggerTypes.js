// helpers/triggerTypes.js
// ============================================================
// Single source of truth for event types — consumed by both the
// executor (matchesTrigger / isEventCompatible) and the editor
// (OperationsTab event-type dropdown).
//
// Each entry carries:
//   value         — runtime trigger key written into operation.triggerTypes
//   label         — UI display name
//   desc          — UI tooltip / help text
//   transaction*  — which Transaction.type(s) this event maps to:
//                   transactionType: string | null   (null = onLoad)
//                   transactionTypes: string[]       (when one event matches multiple)
//                   transactionType: "__manual__"    (sentinel — never auto-fires)
//   extraGuard    — optional (transaction) => boolean further filter applied
//                   AFTER the type match (used for value-based gates like
//                   onComplete=truthy, onUncomplete=falsy, onReorder=same-container)
//   hidden        — true → not shown in editor dropdown (alias-only entries)
// ============================================================

export const EVENT_TYPES = [
  { value: "onChange",       label: "On Change",        desc: "Fires when a value or property changes",                            transactionType: "MeasureOp" },
  { value: "onFieldChange",  label: "On Field Change",  desc: "Alias of onChange (respects allowedFields)",                        transactionType: "MeasureOp" },
  { value: "onComplete",     label: "On Complete",      desc: "Fires when a module or field reaches a done state",                  transactionType: "MeasureOp",
    extraGuard: (tx) => Boolean(tx?.value) || tx?.value === 1 },
  { value: "onUncomplete",   label: "On Uncomplete",    desc: "Fires when a completion is reversed",                                transactionType: "MeasureOp",
    extraGuard: (tx) => !tx?.value },
  { value: "onAdd",          label: "On Add",           desc: "Fires when something is added or created",                           transactionType: "OccurrenceCreateOp" },
  { value: "onCreate",       label: "On Create",        desc: "Alias of onAdd",                                                      transactionType: "OccurrenceCreateOp", hidden: true },
  { value: "onRemove",       label: "On Remove",        desc: "Fires when something is removed from a parent",                      transactionType: "OccurrenceDeleteOp" },
  { value: "onDelete",       label: "On Delete",        desc: "Fires when something is permanently deleted",                        transactionType: "OccurrenceDeleteOp" },
  { value: "onMove",         label: "On Move",          desc: "Fires when something is moved between parents",                      transactionTypes: ["OccurrenceMoveOp", "OccurrenceListOp"] },
  { value: "onReorder",      label: "On Reorder",       desc: "Fires when something is reordered within a parent",                  transactionType: "OccurrenceListOp",
    extraGuard: (tx) => tx?.fromContainerId === tx?.toContainerId },
  { value: "onDrop",         label: "On Drop",          desc: "Any list change",                                                     transactionType: "OccurrenceListOp", hidden: true },
  { value: "onFilterChange", label: "On Filter Change", desc: "Fires when the date filter nav or named filter changes",             transactionType: "NavigationOp" },
  { value: "onNavigation",   label: "On Navigation",    desc: "Alias of onFilterChange",                                             transactionType: "NavigationOp", hidden: true },
  { value: "onLoad",         label: "On Load",          desc: "Fires once when the grid loads",                                      transactionType: null },
  { value: "onButton",       label: "On Button",        desc: "Fires when the operation trigger button is pressed",                 transactionType: "ButtonOp" },
  { value: "onNodeInput",    label: "On Node Input",    desc: "Fires when a local field input on the operation node changes or Run is clicked", transactionType: "NodeInputOp" },
  { value: "onModuleUpdate", label: "On Module Update", desc: "Fires when a module template changes",                                transactionType: "ModuleOp" },
  { value: "onWebhook",      label: "On Webhook",       desc: "Fires via HTTP POST to the webhook URL",                              transactionType: "WebhookOp" },
  { value: "onSchedule",     label: "On Schedule",      desc: "Fires at a specific time (cron)",                                     transactionType: "ScheduleOp" },
  { value: "manual",         label: "Manual",           desc: "Only runs when manually triggered from UI",                           transactionType: "__manual__" },
  { value: "onPomoStart",    label: "On Pomo Start",    desc: "Fires when the user starts a Pomodoro work phase",                    transactionType: "PomoStartOp" },
  { value: "onPomoTick",     label: "On Pomo Tick",     desc: "Fires each running minute and on pause with the Pomodoro's elapsed minutes", transactionType: "PomoTickOp" },
  { value: "onPomoComplete", label: "On Pomo Complete", desc: "Fires when a Pomodoro work phase reaches 00:00 naturally",            transactionType: "PomoCompleteOp" },
  { value: "onPomoStop",     label: "On Pomo Stop",     desc: "Fires when the user resets or skips a Pomodoro mid-phase",            transactionType: "PomoStopOp" },
];

const _byValue = new Map(EVENT_TYPES.map((e) => [e.value, e]));

// VISIBLE_EVENT_TYPES — entries that appear in the editor dropdown.
// Aliases (onCreate/onNavigation/onDrop) stay valid at runtime but aren't
// surfaced to avoid confusing the user with redundant choices.
export const VISIBLE_EVENT_TYPES = EVENT_TYPES.filter((e) => !e.hidden);


// isEventCompatible — gate an event name against the current transaction
// type and payload semantics. Pure type/shape check — no subject/target
// filtering (that lives in matchesTrigger).
export function isEventCompatible(eventType, transactionType, transaction) {
  const def = _byValue.get(eventType);
  if (!def) return false;
  if (def.transactionType === "__manual__") return false;
  const allowed = def.transactionTypes
    || (def.transactionType !== undefined ? [def.transactionType] : []);
  if (!allowed.includes(transactionType)) return false;
  if (def.extraGuard && !def.extraGuard(transaction)) return false;
  return true;
}
