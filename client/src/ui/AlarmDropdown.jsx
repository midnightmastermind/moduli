// ui/AlarmDropdown.jsx
// Toolbar alarm control (moved out of the Command Center's Alarms tab).
// A clock icon that drops down to list/create alarms + reminders, and — when an
// alarm is RINGING — shows a banner with Snooze / Stop so it can be dismissed
// (the ring loops until then; see state/alarmRingStore.js). Mirrors the
// PomodoroTimer toolbar-widget pattern.
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import MenuSurface from "./MenuSurface.jsx";
import { AlarmClock, BellRing, Plus, Trash2, Volume2, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useGridActions } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { buildAlarmOperation, applyAlarmToOperation, listAlarmOperations, formatAlarmTime } from "../helpers/alarmOps";
import { ringAlarm } from "../helpers/alarmSound";
import { subscribeAlarmRing, getAlarmRing, stopAlarmRing, snoozeAlarmRing } from "../state/alarmRingStore";

function AlarmRow({ op, onPatch, onDelete }) {
  const alarm = op.alarm || {};
  const isAlarm = (alarm.type || "alarm") === "alarm";
  const { t, ampm } = formatAlarmTime(alarm.time || "08:00");
  return (
    <div className="flex items-center gap-2 rounded-lg border px-2 py-1.5"
      style={{ background: "var(--input-bg)", borderColor: "var(--border-subtle, rgba(255,255,255,0.08))", opacity: op.enabled ? 1 : 0.55 }}>
      <label className="relative cursor-pointer select-none" title="Change time">
        <span className="text-xl font-light tabular-nums" style={{ color: "var(--text-primary)" }}>{t}</span>
        <span className="text-[10px] ml-1 text-text-muted">{ampm}</span>
        <input type="time" value={alarm.time || "08:00"}
          onChange={(e) => e.target.value && onPatch({ time: e.target.value })}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
      </label>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <input value={alarm.label || ""} placeholder={isAlarm ? "Alarm" : "Reminder"}
          onChange={(e) => onPatch({ label: e.target.value })}
          className="h-5 text-xs bg-transparent px-0 outline-none border-0 text-text-primary" />
        <button type="button" onClick={() => onPatch({ type: isAlarm ? "reminder" : "alarm" })}
          title="Alarms ring + notify; reminders only notify. Click to switch."
          className="self-start inline-flex items-center gap-1 text-[10px] px-1.5 py-px rounded-full border cursor-pointer hover:brightness-125"
          style={isAlarm
            // An alarm rings (warn), a reminder only notifies (neutral-blue).
            // Both were literal tailwind values that ignored the skin entirely.
            ? { color: "rgb(var(--signal-warn))", background: "rgba(var(--signal-warn) / 0.1)", borderColor: "rgba(var(--signal-warn) / 0.3)" }
            : { color: "rgb(var(--signal-zero))", background: "rgba(var(--signal-zero) / 0.1)", borderColor: "rgba(var(--signal-zero) / 0.3)" }}>
          {isAlarm ? <AlarmClock className="w-2.5 h-2.5" /> : <BellRing className="w-2.5 h-2.5" />}
          {isAlarm ? "Alarm" : "Reminder"}
        </button>
      </div>
      {isAlarm && (
        <button type="button" title="Preview sound" onClick={() => ringAlarm({ bursts: 2 })}
          className="text-text-muted hover:text-foreground cursor-pointer"><Volume2 className="w-3.5 h-3.5" /></button>
      )}
      <button type="button" title="Delete" onClick={onDelete}
        className="text-text-muted hover:text-red-400 cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
      <Switch checked={!!op.enabled} onCheckedChange={(v) => onPatch({ enabled: v })} />
    </div>
  );
}

export default function AlarmDropdown() {
  const { state, dispatch, socket, operationsById } = useGridActions();
  const gridId = state?.gridId;
  const userId = state?.userId;
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  const ringing = useSyncExternalStore(subscribeAlarmRing, getAlarmRing, () => null);
  const alarms = useMemo(() => listAlarmOperations(operationsById, gridId), [operationsById, gridId]);

  // Outside press / Escape close (capture-phase pointerdown covers touch too).
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      const inBtn = btnRef.current && btnRef.current.contains(e.target);
      const inPanel = panelRef.current && panelRef.current.contains(e.target);
      if (!inBtn && !inPanel) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey); };
  }, [open]);

  // Schedule field ids the seed stamps on the grid — lets a fired alarm drop an
  // instance onto today's Schedule (like Pomodoro: Start). Absent on grids with
  // no seeded Schedule → the alarm is a plain NOTIFY (alarmScheduleSteps no-ops).
  const sched = state?.grid?.meta?.scheduleFieldIds || null;

  const add = (type) => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const op = buildAlarmOperation({ gridId, userId, type, time: `${hh}:${mm}`, sortOrder: alarms.length, sched });
    CommitHelpers.createOperation({ dispatch, socket, operation: op });
    if (!open) setOpen(true);
  };
  const patch = (op, p) => CommitHelpers.updateOperation({ dispatch, socket, operation: applyAlarmToOperation(op, p) });
  const remove = (op) => CommitHelpers.deleteOperation({ dispatch, socket, operationId: op.id });

  const rect = open ? btnRef.current?.getBoundingClientRect() : null;
  const panelTop = rect ? rect.bottom + 6 : 8;
  const panelRight = rect ? Math.max(6, window.innerWidth - rect.right) : 8;

  return (
    <div style={{ position: "relative", fontFamily: "monospace" }}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={ringing ? `${ringing.label} is ringing` : "Alarms & reminders"}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", position: "relative",
          width: 26, height: 26, borderRadius: 5, cursor: "pointer",
          background: open ? "var(--border-subtle)" : "transparent",
          color: ringing ? "rgb(var(--signal-neg))" : "var(--text-primary)",
          border: "none",
        }}
      >
        <AlarmClock className="w-4 h-4" style={ringing ? { animation: "alarm-shake 0.5s ease-in-out infinite" } : undefined} />
        {ringing && <span style={{ position: "absolute", top: 2, right: 2, width: 6, height: 6, borderRadius: "50%", background: "rgb(var(--signal-neg))", boxShadow: "0 0 6px rgba(var(--signal-neg) / 0.9)" }} />}
      </button>

      {open && (
        <MenuSurface
          surfaceRef={panelRef}
          zIndex={2147483000}
          onClose={() => setOpen(false)}
          // Anchored from the RIGHT edge on desktop (it hangs off a toolbar
          // button), which MenuSurface's top/left position does not express —
          // so this one keeps `right` in its own style and leaves `left` unset.
          // The drawer ignores both.
          position={{ top: panelTop }}
          style={{
            right: panelRight,
            width: 300, maxWidth: "94vw", maxHeight: "70vh", overflowY: "auto",
            background: "var(--surface-card)", border: "1px solid var(--input-border)",
            borderRadius: 8, boxShadow: "var(--menu-shadow-2)", padding: 10,
            display: "flex", flexDirection: "column", gap: 8, fontFamily: "monospace",
          }}>
          {ringing && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8,
              background: "rgba(var(--signal-neg) / 0.14)", border: "1px solid rgba(var(--signal-neg) / 0.45)",
            }}>
              <AlarmClock className="w-4 h-4" style={{ color: "rgb(var(--signal-neg))", flexShrink: 0, animation: "alarm-shake 0.5s ease-in-out infinite" }} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold truncate" style={{ color: "var(--danger-text)" }}>{ringing.label}</div>
                <div className="text-[10px] text-text-faint">Ringing…</div>
              </div>
              <button type="button" onClick={() => snoozeAlarmRing(5)}
                className="text-[11px] px-2 py-1 rounded cursor-pointer"
                style={{ background: "var(--input-bg)", color: "var(--text-primary)" }}>Snooze 5m</button>
              <button type="button" onClick={() => stopAlarmRing()}
                className="text-[11px] px-2 py-1 rounded cursor-pointer font-semibold"
                style={{ background: "var(--danger)", color: "var(--on-danger)" }}>Stop</button>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs text-foreground/90">Alarms &amp; Reminders</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => add("alarm")} title="New alarm"
                className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border cursor-pointer hover:brightness-125"
                style={{ borderColor: "var(--input-border)", color: "var(--text-primary)" }}><Plus className="w-3 h-3" /> Alarm</button>
              <button type="button" onClick={() => add("reminder")} title="New reminder"
                className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border cursor-pointer hover:brightness-125"
                style={{ borderColor: "var(--input-border)", color: "var(--text-primary)" }}><Plus className="w-3 h-3" /> Reminder</button>
              <button type="button" onClick={() => setOpen(false)} className="text-text-muted hover:text-foreground cursor-pointer ml-0.5"><X className="w-3.5 h-3.5" /></button>
            </div>
          </div>

          {alarms.length === 0 && (
            <div className="px-3 py-6 text-center text-text-faint text-[11px]">No alarms yet — add one above.</div>
          )}
          {alarms.map((op) => (
            <AlarmRow key={op.id} op={op} onPatch={(p) => patch(op, p)} onDelete={() => remove(op)} />
          ))}
        </MenuSurface>
      )}
    </div>
  );
}
