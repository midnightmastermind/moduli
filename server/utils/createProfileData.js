// server/utils/createProfileData.js
// ============================================================
// Seeds Profile docs with sections, all placed in the user's "Documents" folder
// ============================================================

import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { nanoid } from "nanoid";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Folder from "../models/Folder.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, "../../");

function uid() {
  return nanoid(12);
}
// ============================================================
// Profile Category Docs (8 categories, each with 3-4 sections)
// ============================================================

const PROFILE_DOCS = [
  {
    title: "Spirituality & Religion",
    intro: "Core lens: Omnism — all spiritual traditions contain truth. No single path owns it.",
    sections: [
      {
        heading: "Traditions & Practices",
        items: [
          "Daoism — wu wei (effortless action), the Tao Te Ching, Zhuangzi. The way that can be spoken is not the eternal way.",
          "Zen Buddhism — direct experience over doctrine, koans, sitting meditation (zazen), no-mind (mushin)",
          "Christianity / The Way — Jesus as teacher of unconditional love, not just savior. Gospel of Thomas: direct gnosis, the Kingdom within.",
          "Native American Spirituality — Menominee tribal roots, land connection, animism, the circle of life",
          "Reiki — energy healing, ki/chi/prana flow through body, hands-on healing",
          "Internal Alchemy (Fabrizio Pregadio) — Daoist neidan (inner alchemy), classical texts, transformation of jing/qi/shen",
          "Alan Watts — synthesis of Eastern philosophy for Western minds. 'The Book: On the Taboo Against Knowing Who You Are'",
          "Terence McKenna — consciousness expansion, plant medicine, timewave zero, the transcendent object at the end of time",
        ],
      },
      {
        heading: "Key Concepts",
        items: [
          "God / Universe / I AM — the ground of being, beyond all names. Brahman, the Tao, the One.",
          "Ego Death — dissolution of the constructed self; liberation from the illusion of separation",
          "Integration — bringing unconscious material into conscious awareness. Jung + spiritual practice.",
          "Flow State — the 'zone'; action without self-consciousness. Csikszentmihalyi + Daoist alignment.",
          "Frequency & Vibration — Tesla: 'If you want to find the secrets of the universe, think in terms of energy, frequency, vibration.' Sound as healing.",
          "Multi-dimensional Time — McKenna, Dark (show), recursion in time, nested realities",
        ],
      },
      {
        heading: "Recommended Texts",
        items: [
          "Tao Te Ching — Laozi (Stephen Mitchell translation)",
          "The Gospel of Thomas — 114 logia of Jesus, non-canonical, Nag Hammadi",
          "The Book — Alan Watts",
          "The Perennial Philosophy — Aldous Huxley (omnism as philosophy)",
          "Inner Alchemy — Fabrizio Pregadio",
          "Integral Theory — Ken Wilber (synthesizes all traditions into quadrants)",
        ],
      },
    ],
  },
  {
    title: "Philosophy & Systems Thinking",
    intro: "The operating system underneath everything. How to think, not just what to think.",
    sections: [
      {
        heading: "Core Thinkers",
        items: [
          "Carl Jung — archetypes, shadow work, the collective unconscious, synchronicity, individuation",
          "Joseph Campbell — The Hero's Journey (monomyth), comparative mythology, 'Follow your bliss'",
          "Alan Watts — Eastern philosophy for Western minds, the game of black-and-white, the eternal now",
          "Stoicism — Epictetus, Marcus Aurelius, Seneca. Control what you can; accept what you cannot.",
          "Ram Dass — Be Here Now, conscious aging, service (karma yoga)",
          "Dan Harmon — Story Circle (8-step hero's journey); TV: Community, Rick and Morty",
        ],
      },
      {
        heading: "Key Frameworks",
        items: [
          "Archetypes — universal patterns of the psyche (Hero, Shadow, Anima/Animus, Self). Jung's map of the unconscious.",
          "Shadow Work — integrating rejected parts of the self. 'Everyone carries a shadow, and the less it is embodied in conscious life, the blacker and denser it is.' — Jung",
          "The Hero's Journey — departure → initiation → return. Monomyth underlying all great stories.",
          "Circular Recursion — patterns that loop back on themselves. Fractals, strange loops (Hofstadter), the Ouroboros.",
          "Integral Theory — Ken Wilber's AQAL map: All Quadrants, All Levels. Interior/exterior × individual/collective.",
          "Systems Thinking — seeing feedback loops, emergence, and relationships rather than isolated parts.",
          "Break Things Down Atomically — reduce to fundamental units, then rebuild. Feynman method.",
          "Relational Thinking — understanding through relationships, not objects. Tao, Jung, ecology.",
        ],
      },
      {
        heading: "Practices",
        items: [
          "Stoic Morning/Evening Review — Marcus Aurelius: examine what you did, what you could do better",
          "Active Imagination — Jung technique: dialogue with unconscious figures in waking fantasy",
          "Journaling — externalizing the inner world, seeing patterns, integrating shadow",
          "CBT/DBT Applied — cognitive restructuring + emotional regulation as philosophical practices",
        ],
      },
    ],
  },
  {
    title: "Science & Exploration",
    intro: "The universe is weirder than we can imagine — and that's the point.",
    sections: [
      {
        heading: "Key Interests",
        items: [
          "Tesla / Nikola Tesla — alternating current, free energy concepts, electromagnetic resonance, 3-6-9 theory",
          "Frequency & Vibration — cymatics (sound shapes matter), Schumann resonance, brainwave entrainment (alpha/theta)",
          "Astronomy & Space — cosmos as context for existence. Carl Sagan's pale blue dot. Hubble deep field.",
          "Multi-dimensions & Time Travel — extra dimensions (string theory), closed timelike curves, block universe theory",
          "Quantum Cognition — applying quantum models to decision-making and consciousness",
          "STEM as spirituality — math is the language of the universe; code is creation",
          "Tech & Computer Science — web development, systems architecture, Iron Man as archetype of builder",
          "Building & Tinkering — making things, understanding how they work, Maker culture",
        ],
      },
      {
        heading: "Consciousness Science",
        items: [
          "The Hard Problem of Consciousness — Chalmers: why is there subjective experience at all?",
          "Integrated Information Theory — Tononi: consciousness as phi (information integration)",
          "Psychedelic Research — Johns Hopkins, MAPS: psilocybin for depression, MDMA for PTSD, neuroplasticity",
          "Flow State Science — Csikszentmihalyi + modern neuroscience: gamma waves, transient hypofrontality",
          "Brain / Heart / Body — interoception, the gut-brain axis, HeartMath (heart coherence), somatic awareness",
        ],
      },
      {
        heading: "Role Models",
        items: [
          "Tony Stark / Iron Man — builder-thinker who uses tech as an extension of will. 'Genius, billionaire, playboy, philanthropist.'",
          "Dr. Strange — the reluctant student who becomes the master. Mastery through surrender.",
          "Da Vinci — the original polymath. Art + science + engineering + philosophy as one.",
          "Tesla — visionary misunderstood by his time. Frequency as fundamental reality.",
        ],
      },
    ],
  },
  {
    title: "Arts, Media & Storytelling",
    intro: "Story is the operating system of the human mind. All these are data.",
    sections: [
      {
        heading: "Music",
        items: [
          "Eminem — technical mastery, vulnerability through armor, trauma-to-art pipeline. 'Stan' is a monument.",
          "Mac Miller — growth through darkness. Swimming, Circles. Self-awareness + addiction + creativity.",
          "Kid Cudi — the lonely astronaut. Mental health as music. 'Pursuit of Happiness'.",
          "Nahko & Medicine for the People — indigenous-rooted, activist, spiritual. 'Manifesto'.",
          "Wu-Tang Clan — sampling as philosophy. 'Wu-Tang is for the children.' Chess, Shaolin, street wisdom.",
          "RATM (Rage Against the Machine) — political fury as music. System critique.",
          "Childish Gambino / Donald Glover — the Renaissance man. 'This Is America' as art.",
          "The Beatles — melody as universal language. Revolution through sound.",
        ],
      },
      {
        heading: "Film & TV",
        items: [
          "Avatar: The Last Airbender — mastery through each element. Ba Sing Se as the denial of truth. Iroh as the mentor archetype.",
          "Dark (Netflix) — time loops, determinism vs. free will, family trauma across generations.",
          "Severance — identity fragmentation, corporate control of consciousness, the severed self.",
          "The OA — dimensions of experience, near-death, the body as instrument, collective ritual.",
          "Mr. Robot — systems thinking, dissociation, capitalism critique. Elliot as unreliable narrator.",
          "Everything Everywhere All at Once — multiverse grief, immigrant experience, absurdist love.",
          "Interstellar — love as a force that transcends spacetime. Cooper's sacrifice.",
          "Rick and Morty — nihilism + love. The show that knows it's a show.",
          "Lord of the Rings — the burden of power, fellowship, the value of small things (hobbits).",
          "Dune — ecological consciousness, chosen one as trap, power corrupts.",
        ],
      },
      {
        heading: "Writing & Comedy",
        items: [
          "Writing — externalizing the inner world. Rhymes as meditation.",
          "Poetry — compression of meaning. Language at maximum density.",
          "Bo Burnham — meta-comedy, depression + performance, 'Inside' as pandemic art.",
          "George Carlin — comedy as social critique. Language as power.",
          "Norm Macdonald — anti-comedy, the joke inside the joke, pure commitment to the bit.",
          "Gaming / D&D — collaborative storytelling, emergent narrative, rules as reality.",
        ],
      },
    ],
  },
  {
    title: "Physical Wellness & Embodied Practice",
    intro: "The body is not separate from the mind. Embodiment is the path, not a detour.",
    sections: [
      {
        heading: "Movement Practices",
        items: [
          "Northern Shaolin — external martial art with deep internal roots. Power through structure.",
          "Tai Chi (Taijiquan) — moving meditation. Yin-yang in motion. The soft overcomes the hard.",
          "Be Shalequan — specific martial tradition combining external and internal principles",
          "Bruce Lee — Jeet Kune Do: 'absorb what is useful, reject what is useless.' Philosophy as martial art.",
          "Flow State — optimal experience in physical practice. When the body knows before the mind.",
        ],
      },
      {
        heading: "Nutrition",
        items: [
          "Mediterranean Diet — whole foods, olive oil, fish, vegetables, community eating.",
          "Keto — fat adaptation, mental clarity, reducing inflammation. Mitochondrial support.",
          "Fasting — autophagy, metabolic flexibility. Letting the body self-clean.",
        ],
      },
      {
        heading: "Mental-Somatic Practices",
        items: [
          "CBT / DBT — cognitive restructuring + distress tolerance. AA as practical CBT.",
          "Growth Mindset — Dweck: the brain is plastic, failure is data, effort creates ability.",
          "Reiki — energy flow through hands. Can be self-practice. Chakra awareness.",
          "Meditation — sitting still with what is. Vipassana (noting), Zen (just sitting), loving-kindness.",
          "Simplicity / Simple Living — Thoreau at Walden Pond. Enough is more. Reduce friction.",
          "Hobbit Hole — the ideal of a cozy, contained, meaningful life. Comfort as sacred.",
        ],
      },
      {
        heading: "Key Concepts",
        items: [
          "Holding On & Letting Go — the fundamental oscillation of life. Breath as model.",
          "Habits & Subconscious — Charles Duhigg: habit loop (cue-routine-reward). Subconscious as autopilot.",
          "Silliness — play is not childish; it's essential. The court jester sees what the king cannot.",
          "Doomsday Prepping — preparedness as peace of mind. Self-reliance, not fear.",
        ],
      },
    ],
  },
  {
    title: "Identity, Sexuality & Personal Expression",
    intro: "Explored, accepted, and integrated without shame. These are natural expressions of the full human spectrum.",
    sections: [
      {
        heading: "Personal Context",
        items: [
          "Grew up in evangelical Christianity — fear-based theology, conditional love, rapture anxiety",
          "CPTSD from early religious and relational trauma — actively healing through AA, therapy, philosophy",
          "AA journey — sobriety as foundation. 12 steps as practical philosophy of accountability and surrender.",
          "Integration as ongoing practice — bringing unconscious material into conscious, compassionate awareness",
        ],
      },
      {
        heading: "Sexuality & Embodiment",
        items: [
          "Kink, ABDL/MDLB, regression, cross-dressing, femdom, embarrassment, sissy — explored and accepted as natural expressions of desire, vulnerability, and relational play",
          "Embarrassment as kink — the productive intersection of shame dissolution and embodied presence",
          "Regression (age play) — returning to states of innocence, play, and being cared for",
          "Cross-dressing / feminine expression — embodying the anima, dissolving rigid gender performance",
          "Femdom — power dynamics as consensual, healing, and intimate",
          "Bedwetting / physical vulnerability — acceptance of the body's full range without judgment",
        ],
      },
      {
        heading: "Philosophical Integration",
        items: [
          "Jung's Anima — the feminine within the masculine. Honoring it rather than suppressing it.",
          "Shadow Integration — these aspects, when repressed, create neurosis. When integrated, create wholeness.",
          "Unconditional Love as foundation — the spiritual antidote to shame-based religion",
          "Personas — Jungian mask theory applied: different authentic expressions in different contexts",
          "The Misfits / The Outsiders — identifying with the disenfranchised, the weird, the outliers",
        ],
      },
    ],
  },
  {
    title: "Social & Civic Thought",
    intro: "The personal is political. Internal work connects to collective transformation.",
    sections: [
      {
        heading: "Political Philosophy",
        items: [
          "Bernie Sanders / Democratic Socialism — healthcare, housing, education as rights. The 1% problem.",
          "Progressive Left — systematic critique of inequality, racism, fascism. Policy as love ethic.",
          "Fighting Hate & Fascism — active resistance. First they came for... Martin Niemöller's warning.",
          "Conquering Fear — both personal (litany against fear, Dune) and political (fear as control mechanism)",
        ],
      },
      {
        heading: "Ethics & Values",
        items: [
          "Caring — as an active practice and fundamental value. bell hooks: 'All About Love'.",
          "Connection — the antidote to addiction (Johann Hari). Community as survival mechanism.",
          "Community Tables of Discussion — Socratic dialogue, town halls, the agora",
          "The Litany Against Fear (Dune) — 'I must not fear. Fear is the mind-killer.' Personal + political mantra.",
        ],
      },
      {
        heading: "Social Context",
        items: [
          "Menominee Tribe — indigenous roots, land sovereignty, cultural preservation",
          "AA Community — radical honesty, peer support, accountability without judgment",
          "The Outsiders / The Misfits — identifying with those society marginalizes",
          "Romance & Love — love as the axis of meaning. Relationship as spiritual practice.",
          "Life — the commitment to being here, fully, without escape.",
        ],
      },
    ],
  },
  {
    title: "Meta & Conceptual Thinking",
    intro: "The way you think about thinking. The architecture of understanding itself.",
    sections: [
      {
        heading: "Core Mental Models",
        items: [
          "Circular Recursion — the snake eating its tail. Patterns that reference themselves. Hofstadter's strange loops.",
          "Break Things Down Atomically — first principles. Elon Musk's approach. Richard Feynman's pedagogy.",
          "Relational Thinking — nothing exists in isolation. Identity through relationship. Ecology as model.",
          "Organizing Data & Libraries — knowledge management as spiritual practice. Zettelkasten, PKM, Moduli itself.",
          "'All Around' Type Systems — systems that do many things well from a unified principle. Tony Stark's suit.",
          "Multi-dimensional thinking — holding multiple frames simultaneously. Integral theory. Quantum superposition as metaphor.",
        ],
      },
      {
        heading: "Conceptual Interests",
        items: [
          "Story, Patterns, Parables & Metaphors — the universal language of the mind. Jesus taught in parables for a reason.",
          "Archetypes as data structures — Jung's archetypes as universal schemas that repeat across cultures",
          "Frequency — the underlying pattern beneath matter. Math, music, light, consciousness.",
          "Sacred Geometry & Fractals — the universe expressing itself through mathematics. Phi, Fibonacci, Metatron's cube.",
          "Iteration — returning to the same point at a higher level. The spiral, not the circle.",
          "Reading & Learning — the ongoing project of the curious mind. Books as conversations across time.",
        ],
      },
      {
        heading: "Applied Meta-Cognition",
        items: [
          "Growth Mindset — knowing that your framework for knowing can expand",
          "Feynman Technique — explain it simply to know if you really understand it",
          "The Map Is Not the Territory — Korzybski. Our models of reality are not reality.",
          "Emergence — complex behavior arising from simple rules. Ant colonies, markets, consciousness.",
          "Moduli as meta-system — this software as an expression of all the above: recursive, relational, iterative, organizing.",
        ],
      },
    ],
  },
];

// ============================================================
// Quick Notes — parse markdown files into containers+instances
// ============================================================

// Note: morenotes.md + gospelofthomasnotes.md are already handled by
// createDefaultUserData.js notebook step — not repeated here to avoid duplicates.
const QUICK_NOTE_FILES = [
  { filename: "philosopherstone.md",     title: "The Philosopher's Stone — Alchemy Notes",  headingLevel: 2 },
  { filename: "comparitive_religion.md", title: "Comparative Religion Notes",                headingLevel: 2 },
  { filename: "gospelthomas.md",         title: "Gospel of Thomas — Text",                   headingLevel: 2 },
  { filename: "uses.md",                 title: "Uses & References",                         headingLevel: 2 },
];


// ---------------- TipTap Helpers ----------------

function buildDocInstanceContent(heading, items) {
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: heading }] },
      {
        type: "bulletList",
        content: items.map((item) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: item }] }],
        })),
      },
    ],
  };
}

function parseMarkdownSections(filePath, maxSections = 8) {
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }
  const lines = raw.split("\n");
  const sections = [];
  let current = { heading: null, lines: [] };
  for (const line of lines) {
    if (line.startsWith("# ")) {
      if (current.heading || current.lines.length) sections.push(current);
      current = { heading: line.replace("# ", "").trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
    if (sections.length >= maxSections) break;
  }
  if (current.heading || current.lines.length) sections.push(current);
  return sections;
}

function linesToItems(lines) {
  const items = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t === "---") continue;
    const bulletMatch = t.match(/^[*\-]\s+(.+)/);
    if (bulletMatch) {
      items.push(bulletMatch[1]);
      continue;
    }
    if (t.length > 2) items.push(t);
  }
  return items.slice(0, 12);
}

// ---------------- Main Export ----------------

export async function createProfileData({ userId, gridId }) {
  // Look up the "Documents" folder dynamically
  const folder = await Folder.findOne({ userId, name: "Documents" });
  if (!folder) throw new Error('Documents folder not found for user');

  const DOCUMENTS_FOLDER_ID = folder.id;
  const allDocs = [];

  // ---------------- PROFILE_DOCS ----------------
  for (const pd of PROFILE_DOCS) {
    const modId = uid();
    const occId = uid();
    const textmap = { type: "doc", content: pd.sections.flatMap(s => buildDocInstanceContent(s.heading, s.items).content) };

    const mod = new Module({ id: modId, userId, gridId, role: "container", kind: "artifact", label: pd.title, meta: { folderId: DOCUMENTS_FOLDER_ID } });
    await mod.save();
    const occ = new Occurrence({ id: occId, userId, gridId, moduleId: modId, iteration: { mode: "persistent" }, textmap });
    await occ.save();

    allDocs.push(occId);
  }

  // ---------------- QUICK_NOTE_FILES ----------------
  for (const { filename, title } of QUICK_NOTE_FILES) {
    const filePath = join(ROOT_DIR, filename);
    const sections = parseMarkdownSections(filePath);
    if (!sections.length) continue;

    const modId = uid();
    const occId = uid();
    const textmap = { type: "doc", content: sections.flatMap(s => buildDocInstanceContent(s.heading || "Section", linesToItems(s.lines)).content) };

    const mod = new Module({ id: modId, userId, gridId, role: "container", kind: "artifact", label: title, meta: { folderId: DOCUMENTS_FOLDER_ID } });
    await mod.save();
    const occ = new Occurrence({ id: occId, userId, gridId, moduleId: modId, iteration: { mode: "persistent" }, textmap });
    await occ.save();

    allDocs.push(occId);
  }

  return allDocs;
}