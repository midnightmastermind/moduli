// server/services/jonahNotes.js
//
// Jonah's notes: three doc pages in the grid's "Jonah" folder that he reads
// only when he needs them (a tool call), so they cost nothing on a question
// that does not touch them. The user can edit all three in the app.
//
//   about    who the user is and how they like things done
//   moduli   how Moduli works, as a user sees it (one "## " section per topic)
//   memory   things Jonah was told to remember (he appends; the user can edit)
//
// A page is found by its identitySignature, never by its label, so renaming a
// note in the app does not lose it.

export const JONAH_FOLDER_NAME = "Jonah";

export const NOTE_SIGNATURES = {
  about: "jonah:about",
  moduli: "jonah:moduli",
  memory: "jonah:memory",
};

export const NOTE_TITLES = {
  about: "About you",
  moduli: "How Moduli works",
  memory: "Remembered",
};

// A tool result is cut at ~6000 characters before the model sees it, so a
// guide is read one topic at a time.
export const NOTE_READ_MAX = 5500;

function inlineText(node) {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "instanceTextblockInline" || node.type === "instancePill") return node.attrs?.instanceLabel || "";
  return (node.content || []).map(inlineText).join("");
}

// A note's TipTap doc as markdown-ish text: headings keep their #s (so topics
// can be split), lists become "- " lines, everything else its text.
export function noteToText(doc) {
  const out = [];
  const walk = (nodes, depth = 0) => {
    for (const n of nodes || []) {
      if (n.type === "heading") out.push(`${"#".repeat(n.attrs?.level || 2)} ${inlineText(n)}`);
      else if (n.type === "paragraph") { const t = inlineText(n); if (t.trim()) out.push(t); }
      else if (n.type === "bulletList" || n.type === "orderedList") {
        for (const li of n.content || []) {
          const [first, ...rest] = li.content || [];
          out.push(`${"  ".repeat(depth)}- ${inlineText(first)}`);
          walk(rest, depth + 1);
        }
      } else if (n.content) walk(n.content, depth);
    }
  };
  walk(doc?.content || []);
  return out.join("\n");
}

// "## Topic" sections of a note's text: [{ title, body }]. Text before the
// first heading is an untitled intro.
export function noteSections(text) {
  const sections = [];
  let cur = { title: "", lines: [] };
  for (const line of String(text || "").split("\n")) {
    const m = line.match(/^#{1,3}\s+(.*)$/);
    if (m) {
      if (cur.title || cur.lines.some((l) => l.trim())) sections.push(cur);
      cur = { title: m[1].trim(), lines: [] };
    } else cur.lines.push(line);
  }
  if (cur.title || cur.lines.some((l) => l.trim())) sections.push(cur);
  return sections.map((s) => ({ title: s.title, body: s.lines.join("\n").trim() }));
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// What a read returns. With no topic, a sectioned note gives its topic list
// (the whole of it rarely fits); a short note is returned whole. A topic picks
// the best-matching section(s) by words in the title.
export function readNote(text, { topic = "", max = NOTE_READ_MAX } = {}) {
  const sections = noteSections(text);
  if (!topic) {
    if (text.length <= max) return { text };
    return { topics: sections.map((s) => s.title).filter(Boolean),
      note: "Too long to read whole. Call again with one of these topics." };
  }
  const words = norm(topic).split(" ").filter(Boolean);
  const scored = sections
    .map((s) => ({ s, score: words.filter((w) => norm(s.title).includes(w) || norm(s.body).includes(w)).length
      + (words.some((w) => norm(s.title).includes(w)) ? words.length : 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { topics: sections.map((s) => s.title).filter(Boolean), note: `Nothing about "${topic}". Topics:` };
  let body = "";
  for (const { s } of scored) {
    const block = `## ${s.title}\n${s.body}\n\n`;
    if (body.length + block.length > max) break;
    body += block;
  }
  return { text: body.trim() || `## ${scored[0].s.title}\n${scored[0].s.body}`.slice(0, max) };
}

// The memory doc with one more remembered line at the end.
export function appendRemembered(doc, note, date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  const content = Array.isArray(doc?.content) ? doc.content.filter((n) => !(n.type === "paragraph" && !n.content?.length)) : [];
  content.push({ type: "paragraph", content: [{ type: "text", text: `${day} — ${String(note).trim()}` }] });
  return { type: "doc", content };
}

// ── Starting text (the migration writes it once; after that the notes are the
// user's and are never overwritten). ──────────────────────────────────────────

export const ABOUT_MD = `# About you

## Who you are
- A senior full-stack developer who built Moduli. You don't need basic concepts explained.
- You like short, direct answers. Say what you did in one sentence.
- You judge things by how they look and feel in the app, not by whether they "should" work.

## Words you use
- Say "instances", never "rows", for the items inside a container.
- "poms grid" is your real, live grid. "test grid 2" (and "test grid 1") are for testing.

## How to act for you
- If something could mean several things, ask which one. Don't guess.
- Don't ask what something is for. Just do the task.
`;

export const MODULI_MD = `# How Moduli works

## The grid and panels
A grid is the whole workspace. It is split into panels (a rows-by-columns layout, or a "mosaic" of resizable panes). Each panel shows one page at a time and keeps a list of pages it can switch between. On a phone you move between panels with the arrows at the screen edges.

## Pages
A page is what a panel shows. Kinds: board (containers side by side or stacked), doc (a document), canvas (free placement and drawing), table, and folder pages (a card grid of a folder's contents). Pages live in folders in the manifest tree (the sidebar).

## Containers, instances, textblocks, files
- A container holds instances (and can hold other containers). Kinds: board, doc, table, canvas, graph.
- An instance is one item: a task, a habit, a movie, a person. It can carry fields.
- A textblock is a block of rich text. A mini textblock sits inline in a sentence like a chip.
- Files (images, video, audio, PDFs, books) are artifacts; they live in the Files folder and can be placed anywhere.

## Modules and occurrences
Every item has a module (what it is: its name and which fields it has) and one or more occurrences (where it is placed). The same module can be placed in many spots; each placement keeps its own field values. Changing the module's name renames every placement.

## Moving and copying
Dragging an item does one of three things, set per item from its round handle's menu:
- Move: it leaves the old spot.
- Copy: a new, independent item.
- Copy-link: a linked copy; changing a field on one changes it on every linked copy.

## Fields
Fields are values on an item: number, text, yes/no, select (pick from a list), date, time/duration, rating, occurrence (pick another item, e.g. a person or a movie), address, when (a date or a repeat), and more. A number can carry a flow: in, out or replace (money in, money out, set a balance). Fields are managed in the Command Center's Fields tab; an item's own fields are in its Settings › Fields.

## Filters and dates
The toolbar date picks the day (or week, month, range) the grid shows. Pages and containers inherit it and can override it: each header's filter menu turns a filter on or off there. An item dated another day is hidden; an undated item shows on every day.

## Operations
Operations are the automation. Each has triggers (on load, when a field changes, when something is added, deleted or moved, when the date changes, on a schedule, a button) and steps (set a variable, loop, if, find, create, update, move, copy-link, apply a template, show a value). Trackers on the Trackers page are operations that add up values for the shown day. They live in the Command Center's Operations tab.

## Templates and feeds
- A template is a saved subtree in the Templates folder. Applying it copies it into a place; "merge" adds only what is missing.
- A feed makes a container fill itself with linked copies of every item matching conditions (e.g. all items tagged "ingredient").

## Schedule, Day Page, Trackers
- Schedule: a column per shown day with half-hour slots, built by operations from the Schedule template. Dragging a routine into a slot dates it.
- Day Page: a column per day (journal, notes, tasks completed, today's reflections).
- Trackers: tiles whose values operations compute (water, steps, money, moods).

## Sharing in and importing
Things come in through the share menu (phone share sheet, the browser extension, Windows share): links become bookmarks, files land in Files, contacts in People, calendar invites in the Schedule. Each type has a share rule in the Command Center's Imports tab. Wikipedia articles and web pages can be imported as doc pages (they land in the Imports folder).

## Command Center and settings
The Command Center (toolbar) has tabs for Grid settings, Fields, Operations, Templates, Imports, Appearance (skins and themes), Files, Connections (Google Drive, API tokens), and Shortcuts. An item's or container's own settings open from its round handle (the radial menu) or a right-click.

## Undo
Ctrl+Z undoes the last thing you did (one gesture at a time). Things operations do on their own are not undo steps.
`;

export const MEMORY_MD = `# Remembered

Things Jonah was asked to remember. Edit or delete lines freely.
`;
