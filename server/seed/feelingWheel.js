// server/seed/feelingWheel.js
// ============================================================
// The Willcox Feeling Wheel (Willcox, G. 1982, Transactional Analysis Journal
// 12(4), 274-276) — 6 core feelings, 36 secondary, 36 tertiary = 72 feelings,
// which matches the source's own description ("72 feelings ... bucketed into
// these 6 groups: sad, mad, scared, joyful, powerful, and peaceful").
//
// DERIVED, NOT TYPED FROM MEMORY. Recalling an emotion taxonomy from memory is
// how you invent data, so this was extracted from the published Positive
// Psychology Toolkit PDF of the wheel by TWO INDEPENDENT readings of the same
// document:
//
//   core -> secondary      from the PDF's text READING ORDER, which clusters
//                          cleanly into 6 groups of 6 and matches the published
//                          wheel.
//   secondary -> tertiary  from the LABEL GEOMETRY — each label's radius and
//                          angle around the diagram's centroid. The ring
//                          boundaries were MEASURED from the radius gaps (40.3
//                          after the 6th label, 34.2 after the 42nd) rather than
//                          guessed, giving exactly 6/36/36 with every secondary
//                          holding exactly ONE tertiary and zero anomalies.
//
// ANCHOR CHECK: the PDF's own prose says "Once you find 'guilty' on the middle
// band of the wheel, you can see that the associated core feeling (nearer the
// centre) is 'sad', and the more specific, nuanced feeling (on the outer band)
// is 'remorseful'." The geometric derivation independently produced
// Sad > Guilty > Remorseful.
//
// Spelling note: the source PDF's own labels carry typos (PEACERFUL, SELFFISH,
// EXITED, ENERGECTIC, FACINATING, DISCUORAGED, SUCCESFUL) — corrected here.
//
// USED BY: the Feelings board in the Library + the Feeling Wheel graph. The
// board is ordinary occurrences, so the set is editable in the app afterwards
// and reusable by anything else (a Mood dropdown, a tracker) — nothing about
// this shape is known to the graph renderer.
// ============================================================

export const FEELING_WHEEL = {
  Mad: {
    Hurt: ["Distant"],
    Hostile: ["Sarcastic"],
    Angry: ["Frustrated"],
    Selfish: ["Jealous"],
    Hateful: ["Irritated"],
    Critical: ["Skeptical"],
  },
  Scared: {
    Confused: ["Bewildered"],
    Rejected: ["Discouraged"],
    Helpless: ["Insignificant"],
    Submissive: ["Inadequate"],
    Insecure: ["Embarrassed"],
    Anxious: ["Overwhelmed"],
  },
  Joyful: {
    Excited: ["Daring"],
    Sensuous: ["Fascinating"],
    Energetic: ["Stimulating"],
    Cheerful: ["Amused"],
    Creative: ["Playful"],
    Hopeful: ["Optimistic"],
  },
  Powerful: {
    Aware: ["Surprised"],
    Proud: ["Successful"],
    Respected: ["Worthwhile"],
    Faithful: ["Confident"],
    Important: ["Discerning"],
    Appreciated: ["Valuable"],
  },
  Peaceful: {
    Loving: ["Serene"],
    Trusting: ["Secure"],
    Nurturing: ["Thankful"],
    Content: ["Relaxed"],
    Thoughtful: ["Pensive"],
    Intimate: ["Responsive"],
  },
  Sad: {
    Lonely: ["Isolated"],
    Bored: ["Apathetic"],
    Tired: ["Sleepy"],
    Guilty: ["Remorseful"],
    Ashamed: ["Stupid"],
    Depressed: ["Inferior"],
  },
};

/**
 * Flat list of every feeling with its depth and parent LABEL — what a seed or
 * migration walks to mint one occurrence per feeling, nested by container.
 * Depth is the wheel's ring: 0 core, 1 secondary, 2 tertiary.
 */
export function flattenFeelingWheel() {
  const out = [];
  for (const [core, secs] of Object.entries(FEELING_WHEEL)) {
    out.push({ label: core, depth: 0, parent: null });
    for (const [sec, ters] of Object.entries(secs)) {
      out.push({ label: sec, depth: 1, parent: core });
      for (const t of ters) out.push({ label: t, depth: 2, parent: sec });
    }
  }
  return out;
}
