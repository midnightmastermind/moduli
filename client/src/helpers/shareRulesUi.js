// helpers/shareRulesUi.js
//
// The Imports tab's decisions, pure so they are tested without mounting the
// Command Center. A share RULE is an ordinary operation whose trigger is
// `{ eventType: "onShare", shareType }` (server services/shareRules.js) — the
// tab is a filtered, share-shaped view over operations, not a second store.

export const CATCH_ALL = "*";

// The classifier's tokens (server services/shareClassify.js), in menu order.
export const SHARE_TYPES = [
  { id: "link",  label: "Link" },
  { id: "text",  label: "Text" },
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
  { id: "pdf",   label: "PDF" },
  { id: "ics",   label: "Calendar (.ics)" },
  { id: "file",  label: "Other file" },
];

// What a rule can read, per type (spec §3's property catalogue). This is what
// the tab shows beside the editor, so a rule author need not guess a path.
const COMMON = ["$share.type", "$share.source", "$share.label", "$share.externalId", "$share.receivedAt"];
export const SHARE_PROPS = {
  link:  ["$share.props.url", "$share.props.title", "$share.props.description", "$share.props.siteName",
          "$share.props.image", "$share.props.favicon", "$share.props.text", "$share.props.shape"],
  text:  ["$share.props.text", "$share.props.firstLine"],
  html:  ["$share.props.text", "$share.props.firstLine", "$share.props.html"],
  ics:   ["$share.events", "$e.summary", "$e.start.date", "$e.start.timeSlot", "$e.durationMin",
          "$e.location", "$e.uid"],
  image: ["$share.props.occurrenceId", "$share.props.fileRef", "$share.props.filename", "$share.props.mimeType"],
  video: ["$share.props.occurrenceId", "$share.props.fileRef", "$share.props.filename", "$share.props.sizeBytes"],
  audio: ["$share.props.occurrenceId", "$share.props.fileRef", "$share.props.filename", "$share.props.sizeBytes"],
  pdf:   ["$share.props.occurrenceId", "$share.props.fileRef", "$share.props.filename", "$share.props.sizeBytes"],
  file:  ["$share.props.occurrenceId", "$share.props.fileRef", "$share.props.filename", "$share.props.sizeBytes"],
  [CATCH_ALL]: ["$share.props.*", "$share.clip (browser extension clips)"],
};
export const sharePropsFor = (type) => [...COMMON, ...(SHARE_PROPS[type] || [])];

export const shareTriggerOf = (op) =>
  (op?.triggerObjects || []).find(t => t?.eventType === "onShare") || null;

export const isCatchAll = (op) => shareTriggerOf(op)?.shareType === CATCH_ALL;

const priorityOf = (op) => op.priority ?? shareTriggerOf(op)?.priority ?? 50;

/** This grid's share rules, in the order the server runs them: typed by priority, catch-all last. */
export function shareRulesFrom(operations = [], gridId) {
  return operations
    .filter(op => op && op.gridId === gridId && shareTriggerOf(op))
    .sort((a, b) => (isCatchAll(a) ? 1 : 0) - (isCatchAll(b) ? 1 : 0) || priorityOf(a) - priorityOf(b));
}

/** Types that have no rule yet — ONE RULE PER TYPE (D8), so a taken type is not offered again. */
export function freeShareTypes(rules = []) {
  const taken = new Set(rules.map(r => shareTriggerOf(r)?.shareType));
  return SHARE_TYPES.filter(t => !taken.has(t.id));
}

/** A new, empty rule for one type. The user builds its steps; nothing is pre-filled (D18/D19). */
export function newShareRule({ id, gridId, shareType, sortOrder = 0 }) {
  const label = SHARE_TYPES.find(t => t.id === shareType)?.label || shareType;
  return {
    id, gridId,
    name: `Share: ${label.toLowerCase()}`,
    description: "",
    enabled: true,
    priority: 10,
    sortOrder,
    triggerObjects: [{ eventType: "onShare", shareType }],
    triggerTypes: ["onShare"],
    triggerType: "onShare",
    pipeline: { sources: [], steps: [] },
    meta: { userEdited: true },
  };
}

// HALTING (D9) is an ordinary SET_VAR of `$share.handled` — the engine checks
// it between rules. The tab exposes it as one checkbox so nobody has to know
// the variable name; the step it adds is marked so the box can find it again.
const HALT_MARK = "shareHalt";
const isHaltStep = (s) => s?.config?.type === "SET_VAR" && s?.config?.name === "$share.handled";

export const haltsChain = (pipeline) => (pipeline?.steps || []).some(isHaltStep);

export function setHaltsChain(pipeline, on, newId) {
  const steps = (pipeline?.steps || []).filter(s => !isHaltStep(s));
  if (on) steps.push({ id: newId, type: "action", [HALT_MARK]: true,
    config: { type: "SET_VAR", name: "$share.handled", value: "true" } });
  return { ...(pipeline || {}), steps };
}

/** Saving a rule marks it the user's, so the catch-all's automatic upgrade never overwrites it. */
export const markUserEdited = (op) => ({ ...op, meta: { ...(op.meta || {}), userEdited: true } });

/** The recent-shares log, newest first. */
export const recentShares = (grid) => [...(grid?.shareLog || [])].reverse();
