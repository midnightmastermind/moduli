// ui/PomodoroTimer.jsx
// ============================================================
// Compact Pomodoro timer for the toolbar (N13)
// Inline: ring + countdown time only — click to expand
// Slide-down panel: full controls (play/pause/reset/skip + phase info)
// ============================================================

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause, RotateCcw, SkipForward } from "lucide-react";
import { toast } from "../state/notificationStore";
import { operationsBridge } from "../state/bindSocketToStore";
import { useGridActions } from "../GridActionsContext";
import * as CommitHelpers from "./../helpers/CommitHelpers";

const PHASES = [
  { label: "Work",       duration: 25 * 60, color: "#ef4444" },
  { label: "Break",      duration:  5 * 60, color: "#22c55e" },
  { label: "Work",       duration: 25 * 60, color: "#ef4444" },
  { label: "Break",      duration:  5 * 60, color: "#22c55e" },
  { label: "Work",       duration: 25 * 60, color: "#ef4444" },
  { label: "Break",      duration:  5 * 60, color: "#22c55e" },
  { label: "Work",       duration: 25 * 60, color: "#ef4444" },
  { label: "Long Break", duration: 15 * 60, color: "#3b82f6" },
];

function fmt(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Slot label in the format Schedule: Build Day mints (e.g. "9:00am",
// "12:00pm"). Hour-rounded; minutes ignored — sessions land in the
// hour-slot they're started in. Schedule slot containers carry
// meta.slotLabel matching this exact format so the Pomodoro: Start op's
// FIND resolves by string equality.
function currentSlotLabel(now = new Date()) {
  const h24 = now.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const ampm = h24 < 12 ? "am" : "pm";
  return `${h12}:00${ampm}`;
}

export default function PomodoroTimer() {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [remaining, setRemaining] = useState(PHASES[0].duration);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const intervalRef = useRef(null);
  const panelRef = useRef(null);
  const triggerRef = useRef(null);

  // Target-container picker (docket item). Stores the user's preferred
  // destination for Pomodoro:Start writes on `grid.meta.pomodoroTargetContainerId`.
  // When unset, the op falls back to its existing slotLabel-based FIND
  // (current behavior). When set, the transaction carries `targetContainerId`
  // so the op (or future ops) can route directly to the chosen container.
  const { dispatch, socket, state, modulesById, occurrencesById } = useGridActions();
  const grid = state?.grid;
  const targetContainerId = grid?.meta?.pomodoroTargetContainerId || null;
  // Build options keyed by container occurrence so each PLACEMENT shows
  // its own Page › Container chain. The pomodoroTargetContainerId stored
  // on the grid is the occurrence id (was the module id — same shape,
  // routes to a specific placement now). The op accepts either.
  const containerOptions = useMemo(() => {
    const occMap = occurrencesById || {};
    // Reverse parent map: childOccId → parentOccId via occurrences[].
    const parentByChild = {};
    for (const occ of Object.values(occMap)) {
      for (const childId of occ?.occurrences || []) parentByChild[childId] = occ.id;
    }
    const labelFor = (occ) => {
      const mod = modulesById?.[occ.moduleId] || modulesById?.[occ.targetId];
      return mod?.label || occ.label || occ.id.slice(0, 6);
    };
    const out = [];
    for (const occ of Object.values(occMap)) {
      const mod = modulesById?.[occ.moduleId] || modulesById?.[occ.targetId];
      if (!mod || mod.role !== "container") continue;
      // Walk up to find page-chain crumbs.
      const crumbs = [];
      let cur = parentByChild[occ.id] || occ.parentId;
      const seen = new Set();
      let depth = 0;
      while (cur && !seen.has(cur) && depth++ < 8) {
        seen.add(cur);
        const a = occMap[cur];
        if (!a) break;
        const am = modulesById?.[a.moduleId] || modulesById?.[a.targetId];
        if (am?.label) crumbs.unshift(am.label);
        if (am?.role === "page") break;
        cur = parentByChild[cur] || a.parentId;
      }
      const chain = crumbs.join(" › ");
      const label = labelFor(occ);
      out.push({
        id: occ.id,
        label: chain ? `${chain} › ${label}` : label,
      });
    }
    out.sort((a, b) => (a.label || "").localeCompare(b.label || ""));
    return out;
  }, [modulesById, occurrencesById]);
  const setTargetContainer = useCallback((id) => {
    if (!grid?.id && !grid?._id) return;
    const gridId = grid.id || grid._id;
    CommitHelpers.updateGrid({
      dispatch, socket, gridId,
      grid: { meta: { ...(grid.meta || {}), pomodoroTargetContainerId: id || null } },
      emit: true,
    });
  }, [grid, dispatch, socket]);

  const phase = PHASES[phaseIndex % PHASES.length];

  // Tick
  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setRemaining(r => {
        if (r <= 1) {
          clearInterval(intervalRef.current);
          setRunning(false);
          const nextIdx = (phaseIndex + 1) % PHASES.length;
          const nextPhase = PHASES[nextIdx];
          // Natural completion of a work phase → fire Pomodoro: Complete
          // (time ran out → the session completes at the full phase length).
          // Break phases naturally completing is a no-op (nothing to mark
          // done in the schedule).
          if (phase.label === "Work") {
            operationsBridge.fireOperations?.("PomoCompleteOp", {
              type: "PomoCompleteOp",
              minutes: Math.round(phase.duration / 60),
            });
          }
          toast.success(`${phase.label} complete! Up next: ${nextPhase.label}`, { duration: 6000 });
          setPhaseIndex(nextIdx);
          setRemaining(nextPhase.duration);
          return 0;
        }
        // Each running minute of a work phase, sync the open session's
        // elapsed minutes — the session's time is its RUNNING time, not a
        // baked 25. Completing early (checkbox) then counts a shorter
        // pomodoro; the timeout path above completes at the full length.
        if (phase.label === "Work") {
          const elapsed = phase.duration - (r - 1);
          if (elapsed > 0 && elapsed % 60 === 0) {
            operationsBridge.fireOperations?.("PomoTickOp", {
              type: "PomoTickOp",
              minutes: Math.floor(elapsed / 60),
            });
          }
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [running, phaseIndex, phase.label, phase.duration]);

  const toggleRun = useCallback(() => {
    setRunning(prev => {
      const next = !prev;
      // FIRST start of a work phase (untouched countdown) → fire Pomodoro:
      // Start. A pause→resume must NOT mint a second session — the phase's
      // session already exists; only a fresh phase creates one. The session
      // starts at 0 minutes: its time is the RUNNING time, kept current by
      // the minute ticks below. Break phases are local-only.
      if (next && phase.label === "Work" && remaining === phase.duration) {
        const pomoNumber = (phaseIndex / 2 | 0) + 1; // 1..4 within the cycle
        operationsBridge.fireOperations?.("PomoStartOp", {
          type: "PomoStartOp",
          slotLabel: currentSlotLabel(),
          minutes: 0,
          pomoNumber,
          phase: "work",
          // When the user has picked a target container, pass its id through
          // so the op can FIND by id instead of by slot label.
          targetContainerId: targetContainerId || null,
        });
      }
      // Pausing a running work phase → sync the elapsed minutes onto the
      // open session so its stored time is current at the moment of pause.
      if (!next && phase.label === "Work") {
        const elapsedMin = Math.floor((phase.duration - remaining) / 60);
        if (elapsedMin > 0) {
          operationsBridge.fireOperations?.("PomoTickOp", {
            type: "PomoTickOp",
            minutes: elapsedMin,
          });
        }
      }
      return next;
    });
  }, [phase.label, phase.duration, phaseIndex, remaining, targetContainerId]);
  const reset = useCallback(() => {
    // Abandoning a running work phase → delete the open Schedule session.
    if (running && phase.label === "Work") {
      operationsBridge.fireOperations?.("PomoStopOp", { type: "PomoStopOp" });
    }
    setRunning(false);
    setRemaining(phase.duration);
  }, [running, phase.label, phase.duration]);
  const skip = useCallback(() => {
    if (running && phase.label === "Work") {
      operationsBridge.fireOperations?.("PomoStopOp", { type: "PomoStopOp" });
    }
    setRunning(false);
    const nextIdx = (phaseIndex + 1) % PHASES.length;
    setPhaseIndex(nextIdx);
    setRemaining(PHASES[nextIdx].duration);
  }, [phaseIndex, running, phase.label]);

  // Close on outside click
  useEffect(() => {
    if (!expanded) return;
    const handler = (e) => {
      if (!panelRef.current?.contains(e.target) && !triggerRef.current?.contains(e.target)) {
        setExpanded(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [expanded]);

  // Close on Escape
  useEffect(() => {
    if (!expanded) return;
    const handler = (e) => { if (e.key === "Escape") setExpanded(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [expanded]);

  const progress = 1 - remaining / phase.duration;
  const circumference = 2 * Math.PI * 7; // r=7
  const dash = circumference * progress;

  const pomodorosComplete = Math.floor(phaseIndex / 2);
  const pomodorosDots = Array.from({ length: 4 }, (_, i) => i < pomodorosComplete % 4);

  return (
    <div style={{ position: "relative", fontFamily: "monospace" }}>
      {/* ── COMPACT BAR WIDGET ── */}
      <div
        ref={triggerRef}
        onClick={() => setExpanded(v => !v)}
        title={`${phase.label} — ${fmt(remaining)} remaining. Click to ${expanded ? "hide" : "show"} controls.`}
        style={{
          display: "flex", alignItems: "center", gap: 5, cursor: "pointer",
          padding: "2px 6px", borderRadius: 5,
          background: expanded ? "var(--border-subtle)" : "transparent",
          transition: "background 0.15s",
        }}
      >
        {/* Progress ring */}
        <svg width="18" height="18" style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
          <circle cx="9" cy="9" r="7" fill="none" stroke="var(--border-default)" strokeWidth="2" />
          <circle
            cx="9" cy="9" r="7" fill="none"
            stroke={phase.color}
            strokeWidth="2"
            strokeDasharray={`${dash} ${circumference}`}
            style={{ transition: "stroke-dasharray 0.5s linear" }}
          />
        </svg>
        {/* Time */}
        <span style={{
          fontSize: 11,
          color: remaining <= 60 && running ? phase.color : "var(--text-primary)",
          minWidth: 36, letterSpacing: "0.5px", transition: "color 0.3s",
        }}>
          {fmt(remaining)}
        </span>
        {/* Running indicator dot */}
        {running && (
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: phase.color, flexShrink: 0 }} />
        )}
      </div>

      {/* ── SLIDE-DOWN CONTROL PANEL ── */}
      <div
        ref={panelRef}
        style={{
          position: "fixed",
          top: 36,
          right: 120,
          zIndex: 1200,
          background: "var(--surface-card)",
          border: "1px solid var(--input-border)",
          borderRadius: 8,
          padding: "12px 14px",
          minWidth: 180,
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          transition: "transform 0.2s ease, opacity 0.2s ease",
          transform: expanded ? "translateY(0)" : "translateY(-8px)",
          opacity: expanded ? 1 : 0,
          pointerEvents: expanded ? "auto" : "none",
        }}
      >
        {/* Phase label */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: phase.color }}>{phase.label}</span>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
            {fmt(remaining)} left
          </span>
        </div>

        {/* Progress bar */}
        <div style={{ height: 3, background: "var(--border-default)", borderRadius: 2, marginBottom: 12, overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: 2,
            background: phase.color,
            width: `${progress * 100}%`,
            transition: "width 0.5s linear",
          }} />
        </div>

        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center", marginBottom: 10 }}>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={reset} title="Reset">
            <RotateCcw className="h-3.5 w-3.5" style={{ color: "var(--text-muted)" }} />
          </Button>
          <Button
            size="sm" variant="ghost"
            className="h-8 w-8 p-0"
            onClick={toggleRun}
            title={running ? "Pause" : "Start"}
            style={{ background: "var(--input-bg)", borderRadius: 20 }}
          >
            {running
              ? <Pause className="h-4 w-4" style={{ color: phase.color }} />
              : <Play  className="h-4 w-4" style={{ color: "var(--text-primary)" }} />
            }
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={skip} title={`Skip to next`}>
            <SkipForward className="h-3.5 w-3.5" style={{ color: "var(--text-muted)" }} />
          </Button>
        </div>

        {/* Pomodoro dots (4 per cycle) */}
        <div style={{ display: "flex", justifyContent: "center", gap: 5 }}>
          {pomodorosDots.map((done, i) => (
            <div
              key={i}
              style={{
                width: 7, height: 7, borderRadius: "50%",
                background: done ? "var(--danger)" : "var(--border-default)",
                transition: "background 0.3s",
              }}
              title={`Pomodoro ${i + 1}`}
            />
          ))}
        </div>

        {/* Next phase hint */}
        <div style={{ marginTop: 8, fontSize: 10, color: "var(--text-faint)", textAlign: "center" }}>
          Next: {PHASES[(phaseIndex + 1) % PHASES.length].label}
        </div>

        {/* Destination picker — `none` lets the Pomodoro: Start op decide
            (current behavior: falls back to the current hour on today's
            schedule). When a specific page › container is picked, the op
            routes pomodoros there instead. */}
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--border-subtle)" }}>
          <label style={{ display: "block", fontSize: 9, color: "var(--text-faint)", marginBottom: 3 }}>
            Send pomodoros to
          </label>
          <select
            value={targetContainerId || ""}
            onChange={(e) => setTargetContainer(e.target.value || null)}
            style={{
              width: "100%", padding: "3px 5px",
              background: "var(--input-bg)", color: "var(--text-primary)",
              border: "1px solid var(--input-border)", borderRadius: 3,
              fontSize: 10, fontFamily: "var(--font-mono)",
            }}
          >
            {/* No wording — where "none" routes is the operation's business,
                not something the UI pretends to know. */}
            <option value="">None</option>
            {containerOptions.map(o => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
