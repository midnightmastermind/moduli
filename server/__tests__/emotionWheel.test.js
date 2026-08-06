// The Emotions Wheel data — pinned against the chart it was transcribed from.
//
// This is TRANSCRIBED data (read off the supplied wheel image sector by sector
// at 3x zoom), so the tests assert the structural facts visible in that chart.
// If an edit breaks one, the data has drifted from the wheel it claims to be.
import { describe, it, expect } from "vitest";
import { EMOTION_WHEEL, flattenEmotionWheel } from "../seed/emotionWheel.js";

describe("EMOTION_WHEEL matches the supplied chart", () => {
  it("has the 8 core emotions the chart names", () => {
    expect(Object.keys(EMOTION_WHEEL))
      .toEqual(["Happy", "Trust", "Fear", "Surprise", "Sad", "Disgust", "Angry", "Anticipation"]);
  });

  it("totals 120 emotions — 40 secondary + 80 tertiary", () => {
    const secs = Object.values(EMOTION_WHEEL).flatMap(o => Object.keys(o));
    const ters = Object.values(EMOTION_WHEEL).flatMap(o => Object.values(o).flat());
    expect(secs).toHaveLength(40);
    expect(ters).toHaveLength(80);
  });

  it("keeps the chart's UNEVEN shape — four cores with 6, four with 4", () => {
    // The wheel is not regular. Pinned so a future tidy-up cannot quietly
    // even it out.
    const counts = Object.fromEntries(
      Object.entries(EMOTION_WHEEL).map(([c, s]) => [c, Object.keys(s).length]));
    expect(counts).toEqual({
      Happy: 6, Trust: 4, Fear: 6, Surprise: 4,
      Sad: 6, Disgust: 4, Angry: 6, Anticipation: 4,
    });
  });

  it("gives every secondary exactly 2 tertiaries", () => {
    for (const secs of Object.values(EMOTION_WHEEL)) {
      for (const [sec, ters] of Object.entries(secs)) {
        expect(ters, sec + " should have 2").toHaveLength(2);
      }
    }
  });

  it("spot-checks branches read off the chart", () => {
    expect(EMOTION_WHEEL.Happy.Joyful).toEqual(["Ecstatic", "Delight"]);
    expect(EMOTION_WHEEL.Fear.Scared).toEqual(["Frightened", "Terrified"]);
    expect(EMOTION_WHEEL.Sad.Ashamed).toEqual(["Embarrassed", "Guilty"]);
    expect(EMOTION_WHEEL.Anticipation.Stressed).toEqual(["Pressured", "Overwhelmed"]);
  });

  it("covers the vocabulary the OLD Mood field had — the reason THIS wheel is right", () => {
    // Willcox lacked these, which is how the wrong-wheel mistake surfaced: 21 of
    // the grid's 47 Mood words had no counterpart there. They are all here.
    const all = new Set(flattenEmotionWheel().map(f => f.label));
    for (const w of ["Happy", "Grateful", "Calm", "Curious", "Eager", "Interested",
                     "Disgust", "Surprise", "Trust", "Anticipation", "Bored", "Stressed"]) {
      expect(all.has(w), w + " should be on this wheel").toBe(true);
    }
  });

  it("has no duplicate emotion anywhere", () => {
    const all = flattenEmotionWheel().map(f => f.label);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("flattenEmotionWheel", () => {
  it("emits every node once with its ring depth", () => {
    const flat = flattenEmotionWheel();
    expect(flat).toHaveLength(128); // 8 + 40 + 80
    expect(flat.filter(f => f.depth === 0)).toHaveLength(8);
    expect(flat.filter(f => f.depth === 1)).toHaveLength(40);
    expect(flat.filter(f => f.depth === 2)).toHaveLength(80);
  });

  it("gives cores no parent and everything else a real one", () => {
    const flat = flattenEmotionWheel();
    const labels = new Set(flat.map(f => f.label));
    for (const f of flat) {
      if (f.depth === 0) expect(f.parent).toBe(null);
      else expect(labels.has(f.parent)).toBe(true);
    }
  });

  it("orders parents before children, so a seed can mint in one pass", () => {
    const seen = new Set();
    for (const f of flattenEmotionWheel()) {
      if (f.parent) expect(seen.has(f.parent)).toBe(true);
      seen.add(f.label);
    }
  });
});
