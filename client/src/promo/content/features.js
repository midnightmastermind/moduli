// promo/content/features.js
//
// The capability pages. ONE record per page; FeaturePage.jsx renders whichever
// the route names, so adding a page is a data edit and never a new component.
//
// RULE: nothing here may name a thing a USER built. The concrete builds are
// examples of what this product assembles — they live in examples.js, the one
// file exempt from __tests__/noProductDomainKnowledge.test.js. That guard
// scans COMMENTS too, so do not name one here to explain the rule.
// Every number below was measured from the source on 2026-08-18; re-measure
// any you change.

// ORDER IS THE NAV ORDER AND THE CARD ORDER. `build` leads because the site's
// first claim should be the workspace, not one kind of value inside it — the
// same reason the hero headline changed on 2026-08-19.
export const FEATURES = [
  {
    slug: "build",
    nav: "Build it your way",
    title: "Panels, boards, documents, canvases, tables",
    tagline: "The shape of the workspace is yours. Nothing here is a fixed screen.",
    body:
      "There is no built-in layout you have to work around, because there is no built-in layout. You place panels on a grid, fill them with containers, and choose how each one renders. Anything you record can go anywhere — inside a document, on a board, pinned to a canvas, or as a row in a table.",
    points: [
      {
        heading: "Four ways to render the same contents",
        text: "A board of cards, a document you write in, a table of rows and columns, or a canvas you can draw on and connect. Switch between them without moving anything.",
      },
      {
        heading: "One thing, many places",
        text: "The same record can sit in several places at once. Tick it anywhere and it is ticked everywhere, because it is one thing rather than a copy that has to be kept in sync.",
      },
      {
        heading: "Style and layout cascade",
        text: "Set a rule once high up and everything beneath inherits it, or override it exactly where you need to. Five themes ship, and every colour is a token you can change.",
      },
    ],
    stat: { value: "4", label: "ways to render any container" },
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
    slug: "visualize",
    nav: "See it",
    title: "Charts fed by your own records",
    tagline: "Not a dashboard someone designed. A chart pointed at whatever you are keeping.",
    body:
      "A chart is another kind of container: you point it at some of your records, say how to group them, and pick a shape. Because it reads the same data everything else reads, it is never out of date and there is nothing to export or refresh.",
    points: [
      {
        heading: "Seven shapes",
        text: "Bar, line, area, pie, radar, treemap and sunburst — including nested rings for things that have a hierarchy.",
      },
      {
        heading: "It answers clicks",
        text: "Selecting part of a chart can record something, filter what is on screen, or drill into what it is made of. A chart is a control, not a picture.",
      },
      {
        heading: "Scoped by time and category",
        text: "The same chart reads today, this week, this month or a range you pick, without being rebuilt.",
      },
    ],
    stat: { value: "7", label: "chart shapes, fed live" },
    shot: null,
  },
];

export function featureBySlug(slug) {
  return FEATURES.find((f) => f.slug === slug);
}
