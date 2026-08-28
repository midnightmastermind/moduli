// The ringing-alarm store, and the identity the dropdown opens itself on.
//
// Stop and Snooze live inside the alarm panel, and until 2026-08-28 nothing
// opened it — a ringing alarm only shook the button. The panel now opens on a
// NEW ring, which makes the store's ring IDENTITY load-bearing: get it wrong in
// either direction and the feature is either useless (never opens) or a trap
// (re-opens a panel the user keeps closing).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../helpers/alarmSound", () => ({
  ringAlarm: vi.fn(),
  stopAlarm: vi.fn(),
}));

import { ringAlarm, stopAlarm } from "../helpers/alarmSound";
import {
  startAlarmRing, stopAlarmRing, snoozeAlarmRing, getAlarmRing, subscribeAlarmRing, isSnoozed,
} from "../state/alarmRingStore";

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { stopAlarmRing(); vi.useRealTimers(); });

describe("alarmRingStore — a ring's identity", () => {
  it("a ring is visible with its label and carries an id", () => {
    startAlarmRing({ label: "⏰ 5 PM" });
    const r = getAlarmRing();
    expect(r.label).toBe("⏰ 5 PM");
    expect(typeof r.ringId).toBe("number");
    expect(ringAlarm).toHaveBeenCalled();
  });

  // THE CASE THAT MAKES THE AUTO-OPEN SAFE. The store's comment has always
  // claimed this; the code used to reassign `_ringing` (new identity), restart
  // the loop and emit on every call — so a repeat NOTIFY would have re-opened a
  // panel the user had just closed while the SAME alarm was still going.
  it("re-starting the SAME alarm while it rings keeps one identity and notifies nobody", () => {
    const sub = vi.fn();
    startAlarmRing({ label: "⏰ 5 PM" });
    const first = getAlarmRing();
    subscribeAlarmRing(sub);

    startAlarmRing({ label: "⏰ 5 PM" });
    startAlarmRing({ label: "⏰ 5 PM" });

    expect(getAlarmRing()).toBe(first);              // same object, same ringId
    expect(getAlarmRing().ringId).toBe(first.ringId);
    expect(sub).not.toHaveBeenCalled();              // nothing changed → no emit
  });

  // …and the inverse, or the guard above would just be "never open twice".
  it("a DIFFERENT alarm ringing mints a new id, so the panel opens for it", () => {
    startAlarmRing({ label: "⏰ 5 PM" });
    const first = getAlarmRing().ringId;
    startAlarmRing({ label: "⏰ 6:30 AM" });
    expect(getAlarmRing().label).toBe("⏰ 6:30 AM");
    expect(getAlarmRing().ringId).not.toBe(first);
  });

  it("stopping clears the ring and silences the beeps already scheduled", () => {
    startAlarmRing({ label: "⏰ 5 PM" });
    stopAlarmRing();
    expect(getAlarmRing()).toBeNull();
    expect(stopAlarm).toHaveBeenCalled();
  });

  it("the same alarm ringing AGAIN after a stop is a new ring", () => {
    startAlarmRing({ label: "⏰ 5 PM" });
    const first = getAlarmRing().ringId;
    stopAlarmRing();
    startAlarmRing({ label: "⏰ 5 PM" });
    expect(getAlarmRing().ringId).not.toBe(first);
  });

  // A snooze exists to bring the alarm BACK — so its re-ring has to be a new
  // ring, or the panel would stay shut on the one the user asked to be reminded by.
  it("a snoozed alarm comes back as a new ring", () => {
    startAlarmRing({ label: "⏰ 5 PM" });
    const first = getAlarmRing().ringId;
    snoozeAlarmRing(5);
    expect(getAlarmRing()).toBeNull();
    expect(isSnoozed()).toBe(true);

    vi.advanceTimersByTime(5 * 60 * 1000 + 10);
    expect(getAlarmRing()?.label).toBe("⏰ 5 PM");
    expect(getAlarmRing().ringId).not.toBe(first);
  });

  // THE AUDIO MUST NOT BE ABLE TO COST US THE BANNER. `alarmSound` says it is
  // "safe to call from anywhere — the notification still shows", and the banner
  // is now the only thing that puts Stop and Snooze on screen. If a WebAudio
  // throw could take the ring state with it, a failed sound would leave an
  // alarm the user cannot dismiss.
  it("still rings VISUALLY when the sound throws", () => {
    ringAlarm.mockImplementationOnce(() => { throw new Error("AudioContext blew up"); });
    const sub = vi.fn();
    subscribeAlarmRing(sub);
    expect(() => startAlarmRing({ label: "⏰ 5 PM" })).not.toThrow();
    expect(getAlarmRing()?.label).toBe("⏰ 5 PM");
    expect(sub).toHaveBeenCalled();          // subscribers heard about it
  });

  // WHY THE ID IS A COUNTER AND NOT `startedAt`: two rings inside one
  // millisecond would share a timestamp and read as the same ring.
  it("two rings in the same millisecond still have different ids", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    startAlarmRing({ label: "A" });
    const a = getAlarmRing();
    startAlarmRing({ label: "B" });
    const b = getAlarmRing();
    expect(a.startedAt).toBe(b.startedAt);   // the timestamp cannot tell them apart
    expect(a.ringId).not.toBe(b.ringId);     // the id can
    now.mockRestore();
  });
});
