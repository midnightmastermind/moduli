// __tests__/alarmSound.test.js
// stopAlarm() must silence beeps that are ALREADY scheduled on the audio
// timeline — clearing a JS interval alone lets the current burst play out
// (the "Stop finishes the ring first" bug).
import { describe, it, expect, beforeEach, vi } from "vitest";

function makeFakeAudioContext() {
  const oscillators = [];
  const gains = [];
  const ac = {
    currentTime: 10,
    destination: {},
    resume: vi.fn(),
    createOscillator() {
      const osc = {
        type: "",
        frequency: { value: 0 },
        onended: null,
        started: null,
        stoppedAt: null,
        connect: (n) => n,
        start(at) { this.started = at; },
        stop(at) { this.stoppedAt = at; },
      };
      oscillators.push(osc);
      return osc;
    },
    createGain() {
      const g = {
        gain: {
          value: 0.2,
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          cancelScheduledValues: vi.fn(),
        },
        connect: (n) => n,
      };
      gains.push(g);
      return g;
    },
  };
  return { ac, oscillators, gains };
}

describe("alarmSound stopAlarm", () => {
  let fake;

  beforeEach(async () => {
    vi.resetModules();
    fake = makeFakeAudioContext();
    global.window = global.window || {};
    window.AudioContext = function () { return fake.ac; };
  });

  it("cancels beeps that were scheduled but have not sounded yet", async () => {
    const { ringAlarm, stopAlarm } = await import("../helpers/alarmSound");
    ringAlarm({ bursts: 4 });

    // 4 beeps per burst; the last is scheduled ~2.5s out from now.
    expect(fake.oscillators.length).toBe(16);
    const last = fake.oscillators[fake.oscillators.length - 1];
    expect(last.stoppedAt).toBeGreaterThan(fake.ac.currentTime + 2);

    stopAlarm();

    // Every oscillator is re-stopped at ~now, so nothing keeps sounding.
    for (const osc of fake.oscillators) {
      expect(osc.stoppedAt).toBeLessThanOrEqual(fake.ac.currentTime + 0.02);
    }
    // And each gain was ramped down rather than hard-cut (no click).
    for (const g of fake.gains) {
      expect(g.gain.cancelScheduledValues).toHaveBeenCalled();
      expect(g.gain.linearRampToValueAtTime).toHaveBeenCalled();
    }
  });

  it("is safe to call when nothing has rung", async () => {
    const { stopAlarm } = await import("../helpers/alarmSound");
    expect(stopAlarm()).toBe(false);
  });

  it("forgets beeps that already ended, so a later stop is a no-op on them", async () => {
    const { ringAlarm, stopAlarm } = await import("../helpers/alarmSound");
    ringAlarm({ bursts: 1 });
    const [first] = fake.oscillators;
    first.onended();          // browser fires this when the beep finishes
    first.stoppedAt = "kept"; // prove stopAlarm never touches it again

    stopAlarm();
    expect(first.stoppedAt).toBe("kept");
  });
});
