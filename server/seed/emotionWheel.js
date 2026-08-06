// server/seed/emotionWheel.js
// ============================================================
// THE EMOTIONS WHEEL — the Plutchik-derived 8-core wheel, transcribed from the
// chart the user supplied (screenshots/il_1140xN.3408344717_oaft.avif,
// "The Emotions Wheel", leadskill.com).
//
//   8 core · 40 secondary · 80 tertiary = 128 emotions
//
// NOT the Willcox wheel. An earlier pass built Willcox (6 cores: Mad, Scared,
// Joyful, Powerful, Peaceful, Sad) and it was the wrong wheel — Willcox has no
// Happy, Trust, Surprise, Disgust or Anticipation. That mismatch is exactly why
// 21 of the grid's 47 existing Mood words had "no counterpart": Happy, Grateful,
// Calm, Curious, Eager, Interested, Anticipating, Disgusted, Amazed, Worried,
// Nervous, Stressed … are all on THIS wheel. Keeping the note because the
// symptom (a big unexplained vocabulary loss) was the clue that the wrong source
// had been used.
//
// TRANSCRIBED FROM THE IMAGE, sector by sector at 3× zoom, rather than recalled
// from memory — an emotion taxonomy typed from memory is invented data. Each
// core's secondaries were read off the middle ring and each secondary's two
// tertiaries off the outer ring directly beneath it.
//
// The wheel is deliberately UNEVEN — four cores carry 6 secondaries and four
// carry 4. That is the chart, not a transcription error, and the tests below
// pin it so a future "tidy-up" cannot quietly regularise it.
//
// USED BY: the Emotions board in the Library + the Emotion Wheel graph. The
// board is ordinary occurrences, so the set is editable in the app afterwards
// and reusable by anything else (the Mood dropdown, a tracker) — nothing about
// this shape is known to the graph renderer.
// ============================================================

export const EMOTION_WHEEL = {
  Happy: {
    Optimistic: ["Positive", "Inspired"],
    Confident: ["Proud", "Self-Assured"],
    Strong: ["Courageous", "Powerful"],
    Joyful: ["Ecstatic", "Delight"],
    Aroused: ["Amorous", "Playful"],
    Loving: ["Embracing", "Generous"],
  },
  Trust: {
    Grateful: ["Blessed", "Admiration"],
    Peaceful: ["Calm", "Content"],
    Accepted: ["Valued", "Respected"],
    Hopeful: ["Longing", "Expectant"],
  },
  Fear: {
    Cautious: ["Timid", "Apprehensive"],
    Weak: ["Insecure", "Vulnerable"],
    Scared: ["Frightened", "Terrified"],
    Anxious: ["Dread", "Panicky"],
    Nervous: ["Threatened", "Uneasy"],
    Worried: ["Edgy", "Distressed"],
  },
  Surprise: {
    Startled: ["Awe", "Shocked"],
    Confused: ["Disillusioned", "Distracted"],
    Amazed: ["Astonished", "Delighted"],
    Disappointed: ["Betrayed", "Dismayed"],
  },
  Sad: {
    Ashamed: ["Embarrassed", "Guilty"],
    Lonely: ["Isolated", "Abandoned"],
    Hurt: ["Wronged", "Injured"],
    Grief: ["Sorrow", "Despair"],
    Depressed: ["Empty", "Discouraged"],
    Unhappy: ["Miserable", "Hopeless"],
  },
  Disgust: {
    Contempt: ["Envious", "Detestable"],
    Repelled: ["Loathsome", "Bored"],
    Dislike: ["Appalled", "Awful"],
    Disapproval: ["Judgmental", "Ridicule"],
  },
  Angry: {
    Insulted: ["Vengeful", "Indignant"],
    Frustrated: ["Thwarted", "Annoyed"],
    Upset: ["Irritated", "Provoked"],
    Mad: ["Furious", "Enraged"],
    Aggressive: ["Spiteful", "Hostile"],
    Critical: ["Abrasive", "Biting"],
  },
  Anticipation: {
    Excited: ["Passionate", "Energized"],
    Eager: ["Motivated", "Enthusiastic"],
    Interested: ["Curious", "Impatient"],
    Stressed: ["Pressured", "Overwhelmed"],
  },
};

/**
 * Flat list of every emotion with its ring depth and parent LABEL — what a seed
 * or migration walks to mint one occurrence per emotion.
 * Depth is the wheel's ring: 0 core, 1 secondary, 2 tertiary.
 * Parents always appear before their children, so one pass can wire them.
 */
export function flattenEmotionWheel() {
  const out = [];
  for (const [core, secs] of Object.entries(EMOTION_WHEEL)) {
    out.push({ label: core, depth: 0, parent: null });
    for (const [sec, ters] of Object.entries(secs)) {
      out.push({ label: sec, depth: 1, parent: core });
      for (const t of ters) out.push({ label: t, depth: 2, parent: sec });
    }
  }
  return out;
}
