// promo/content/features.js
//
// The capability pages. ONE record per page; FeaturePage.jsx renders whichever
// the route names, so adding a page is a data edit and never a new component.
//
// RULE: nothing here may name a thing a USER built. The concrete builds are
// examples of what this product assembles — they live in examples.js, the one
// file exempt from __tests__/noProductDomainKnowledge.test.js. That guard
// scans COMMENTS too, so do not name one here to explain the rule.
// Every number below was measured from the source. Re-measure any you change —
// two were already stale when this was restructured on 2026-08-19: a container
// converts between FIVE kinds, not four (`graph` joined them on 2026-08-18),
// and eight looks ship, not five.

// ORDER IS THE NAV ORDER AND THE CARD ORDER. `build` leads because the site's
// first claim should be the workspace, not one kind of value inside it — the
// same reason the hero headline changed on 2026-08-19.
//
// THERE IS NO CHARTS PAGE, and that is a claim rather than an omission (user,
// 2026-08-19: "charts is not a top level section — fold it in with tables"). A
// chart is one of the five kinds a container converts between, alongside the
// table and the canvas; giving it its own page would sell it as a reporting
// bolt-on, which is the thing this product is not. It lives in `build`.
//
// THERE IS NO ASSISTANT PAGE EITHER, deliberately. The deck-vs-now audit rates
// it the thinnest thing that ships, and a section would promise more than the
// product does.
export const FEATURES = [
  {
    slug: "build",
    nav: "Build it your way",
    title: "Boards, documents, canvases, tables and charts",
    tagline: "The shape of the workspace is yours. Nothing here is a fixed screen.",
    body:
      "There is no built-in layout you have to work around, because there is no built-in layout. You place panels on a grid, fill them with containers, and choose how each one renders. Anything you record can go anywhere — inside a document, on a board, pinned to a canvas, as a row in a table, or as a slice of a chart. A chart is not a separate feature here; it is one of the ways a container can draw the things inside it.",
    points: [
      {
        heading: "Five ways to render the same contents",
        text: "A board of cards, a document you write in, a table of rows and columns, a canvas you can draw on and connect, or a chart. Switch between them without moving anything — the contents do not change, only how they are drawn.",
      },
      {
        heading: "A chart is a container, not a dashboard",
        text: "Point one at some of your records, say how to group them, and pick from nine shapes — bar, stacked and horizontal bar, line, area, pie, radar, treemap, and nested rings you can click into. It reads the same records everything else reads, so there is nothing to export and nothing to refresh.",
      },
      {
        heading: "Charts answer clicks",
        text: "Selecting part of one can record something, filter what is on screen, or drill into what it is made of. A chart here is a control, not a picture of a control.",
      },
      {
        heading: "One thing, many places",
        text: "The same record can sit in several places at once. Tick it anywhere and it is ticked everywhere, because it is one thing rather than a copy that has to be kept in sync.",
      },
      {
        heading: "Style and layout cascade",
        text: "Set a rule once high up and everything beneath inherits it, or override it exactly where you need to. Eight looks ship — from plain light and dark to fully illustrated ones with their own wallpaper and lettering — and every colour is a token you can change.",
      },
    ],
    stat: { value: "5", label: "ways to render any container" },
    shot: null,
  },
  {
    slug: "measure",
    nav: "Measure anything",
    title: "Every task is a checkbox — or a measurement",
    tagline:
      "Ticking something off tells you it happened. It should also be able to tell you how much.",
    body:
      "Most tools make you choose: a to-do list that knows you did the thing, or a spreadsheet that knows the number. Viafluere is one surface for both. Anything you record can carry values alongside its tick, and those values are real data the moment you enter them — not a note you will have to read back later.",
    points: [
      {
        heading: "Eleven kinds of value",
        text: "Numbers, text, yes/no, dates, durations, ratings, single and multiple choice, addresses, references to other things you have recorded, rich text, and buttons that run something.",
      },
      {
        heading: "Direction, not just size",
        text: "A value knows whether it came in, went out, or replaced what was there. One amount field serves earnings and spending without a second field or a minus sign to remember.",
      },
      {
        heading: "Recorded where it happened",
        text: "Values live on the placement, not the template. The same thing recorded in two places keeps two independent readings, so a repeated activity has a history rather than one number that keeps getting overwritten.",
      },
    ],
    stat: { value: "11", label: "kinds of value a record can carry" },
    shot: null,
  },
  {
    slug: "operations",
    nav: "Operations",
    title: "The maths is yours, and you can read it",
    tagline:
      "Totals, streaks and progress are not features someone built for you. They are pipelines you compose.",
    body:
      "An operation is a readable top-down pipeline: find some things, loop over them, test a condition, add something up, write the answer somewhere. No black-box report, no aggregation you cannot open. If you want a number this product has never heard of, you build it out of the same pieces everything else is built from.",
    points: [
      {
        heading: "114 verbs and comparators",
        text: "Find, loop, branch, sum, average, count, streak, group, sort, slice, join, compare dates and times, create, move, link, apply a template, call an API, ask the user a question.",
      },
      {
        heading: "It runs when something happens",
        text: "Operations fire when a value changes, when something is added, moved or deleted, when you navigate to a different date, on load, or at times you set.",
      },
      {
        heading: "You can see why it did that",
        text: "Every run keeps its log — which candidates were found, which branch was taken, what was written. When a number looks wrong you can read the reason rather than guess at it.",
      },
    ],
    stat: { value: "114", label: "verbs and comparators to compose with" },
    shot: null,
  },
  {
    slug: "intake",
    nav: "Bring anything in",
    title: "Drop it in, then say what it should become",
    tagline: "The same file can become four different things. You decide which, every time.",
    body:
      "Drag in a file, a link, a photo or a block of text and you are asked what you want out of it — never guessed at, never silently defaulted. A document can arrive as a browsable tree of sections. A spreadsheet can arrive as a real table. A photograph of a handwritten list can arrive as a list you can tick off.",
    points: [
      {
        heading: "24 outcomes, offered by what fits",
        text: "Only the shapes that make sense where you dropped it are offered, so the choice stays short even though the catalogue is long.",
      },
      {
        heading: "Documents keep their structure",
        text: "Headings become sections you can open and close, prose becomes text you can edit, tables stay tables, and links stay clickable — and a linked page can be brought in with it.",
      },
      {
        heading: "Text out of pictures",
        text: "A photo of a page becomes readable text; a photo of a list becomes one item per line. The picture is kept either way — it is the evidence.",
      },
    ],
    stat: { value: "24", label: "things a dropped item can become" },
    shot: null,
  },
  {
    slug: "organise",
    nav: "Find it again",
    title: "Everything is somewhere, and scoped to when",
    tagline:
      "A workspace you can keep adding to is only useful if you can still find what you put in it.",
    body:
      "Records live in folders you arrange, reachable from a tree that spans the whole workspace, and any page can be opened in any panel. On top of that sits time: most of what you keep is about a particular day, week, month or year, and saying which one is a control rather than a search.",
    points: [
      {
        heading: "Filters that cascade",
        text: "Set a date at the top and everything beneath answers to it; set a different one on a single page and only that page moves. What you are looking at is always stated, never inferred.",
      },
      {
        heading: "Day, week, month, year — or a range",
        text: "Pick one day, a run of days, a whole month, or several separate days at once. The same records regroup under whichever you choose, and totals follow.",
      },
      {
        heading: "Search that knows where things are",
        text: "Search reaches labels, values, the text inside documents, and the path a thing sits on — so you can find a record by what it says, by what it contains, or by where you left it.",
      },
    ],
    stat: { value: "4", label: "time scopes, from a single day to a year" },
    shot: null,
  },
];

export function featureBySlug(slug) {
  return FEATURES.find((f) => f.slug === slug);
}
