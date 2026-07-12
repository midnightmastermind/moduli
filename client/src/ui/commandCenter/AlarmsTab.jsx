// ui/commandCenter/AlarmsTab.jsx
// ============================================================
// Alarms & Reminders — Android-style alarm list backed by time-based
// Operations. Each row IS an Operation: `op.alarm` marks it managed here,
// `op.schedule` (kind:"atTimes") fires it daily via useScheduler, and its
// pipeline is one NOTIFY (alarms ring + notify, reminders notify only).
// The Operations tab renders these ops READ-ONLY — this tab is their only
// editor (helpers/alarmOps.js owns the op shape).
// ============================================================
import React, { useMemo, useState } from "react";
import { AlarmClock, BellRing, Plus, Trash2, Volume2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGridActions } from "../../GridActionsContext";
import * as CommitHelpers from "../../helpers/CommitHelpers";
import {
  buildAlarmOperation, applyAlarmToOperation, listAlarmOperations, formatAlarmTime,
} from "../../helpers/alarmOps";
import { ringAlarm } from "../../helpers/alarmSound";

function AlarmRow({ op, onPatch, onDelete }) {
  const alarm = op.alarm || {};
  const isAlarm = alarm.type !== "reminder";
  const [t, ampm] = formatAlarmTime(alarm.time).split(" ");
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border"
      style={{
        background: op.enabled ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.015)",
        borderColor: "var(--border-subtle, rgba(255,255,255,0.08))",
        opacity: op.enabled ? 1 : 0.55,
      }}>
      {/* Time — the Android "big clock" block; the native time input sits
          invisibly on top so tapping the time edits it. */}
      <label className="relative cursor-pointer select-none" title="Change time">
        <span className="text-2xl font-light tabular-nums" style={{ color: "var(--text-strong, #fff)" }}>{t}</span>
        <span className="text-[11px] ml-1 text-text-muted">{ampm}</span>
        <input
          type="time"
          value={alarm.time || "08:00"}
          onChange={(e) => e.target.value && onPatch({ time: e.target.value })}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
        />
      </label>

      {/* Label + type */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <Input
          value={alarm.label || ""}
          placeholder={isAlarm ? "Alarm" : "Reminder"}
          onChange={(e) => onPatch({ label: e.target.value })}
          className="h-6 text-xs border-0 bg-transparent px-0 focus-visible:ring-0"
        />
        <button
          type="button"
          onClick={() => onPatch({ type: isAlarm ? "reminder" : "alarm" })}
          title="Alarms ring + notify; reminders only notify. Click to switch."
          className="self-start inline-flex items-center gap-1 text-[10px] px-1.5 py-px rounded-full border cursor-pointer hover:brightness-125"
          style={isAlarm
            ? { color: "rgb(252,211,77)", background: "rgba(252,211,77,0.1)", borderColor: "rgba(252,211,77,0.3)" }
            : { color: "rgb(147,197,253)", background: "rgba(59,130,246,0.1)", borderColor: "rgba(59,130,246,0.3)" }}
        >
          {isAlarm ? <AlarmClock className="w-2.5 h-2.5" /> : <BellRing className="w-2.5 h-2.5" />}
          {isAlarm ? "Alarm — rings" : "Reminder — silent"}
        </button>
      </div>

      {/* Preview ring / delete / enable */}
      {isAlarm && (
        <button type="button" title="Preview sound" onClick={() => ringAlarm({ bursts: 2 })}
          className="text-text-muted hover:text-foreground cursor-pointer">
          <Volume2 className="w-3.5 h-3.5" />
        </button>
      )}
      <button type="button" title="Delete" onClick={onDelete}
        className="text-text-muted hover:text-red-400 cursor-pointer">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
      <Switch checked={!!op.enabled} onCheckedChange={(v) => onPatch({ enabled: v })} />
    </div>
  );
}

export function AlarmsTab() {
  const { state, dispatch, socket, operationsById } = useGridActions();
  const gridId = state?.gridId;
  const userId = state?.userId;
  const alarms = useMemo(() => listAlarmOperations(operationsById, gridId), [operationsById, gridId]);
  const [justAdded, setJustAdded] = useState(null);

  const add = (type) => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const op = buildAlarmOperation({ gridId, userId, type, time: `${hh}:${mm}`, sortOrder: alarms.length });
    CommitHelpers.createOperation({ dispatch, socket, operation: op });
    setJustAdded(op.id);
  };
  const patch = (op, p) =>
    CommitHelpers.updateOperation({ dispatch, socket, operation: applyAlarmToOperation(op, p) });
  const remove = (op) =>
    CommitHelpers.deleteOperation({ dispatch, socket, operationId: op.id });

  return (
    <div className="p-3 flex flex-col gap-2 font-mono">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-xs text-foreground/90">Alarms &amp; Reminders</span>
          <span className="text-[10px] text-text-faint">
            Daily, fired by time-based operations. Alarms ring + notify; reminders only notify.
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-6 text-[11px] gap-1" onClick={() => add("alarm")}>
            <Plus className="w-3 h-3" /> Alarm
          </Button>
          <Button size="sm" variant="outline" className="h-6 text-[11px] gap-1" onClick={() => add("reminder")}>
            <Plus className="w-3 h-3" /> Reminder
          </Button>
        </div>
      </div>

      {alarms.length === 0 && (
        <div className="px-3 py-8 text-center text-text-faint text-[11px]">
          No alarms yet — add one above. Each alarm creates its own time-based operation.
        </div>
      )}
      {alarms.map((op) => (
        <AlarmRow key={op.id} op={op}
          onPatch={(p) => patch(op, p)}
          onDelete={() => remove(op)} />
      ))}
      {justAdded && (
        <span className="text-[10px] text-text-faint px-1">
          Tap the time to set it; the connected operation updates automatically.
        </span>
      )}
    </div>
  );
}

export default AlarmsTab;
