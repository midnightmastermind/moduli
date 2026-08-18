// promo/content/examples.js
//
// THE ONLY FILE ON THE PROMO SURFACE THAT MAY NAME A CONCRETE BUILD.
//
// User, 2026-08-18: "we can include schedule and daypage and trackers and goals
// in an examples page (details for them) but the main site doesnt know that
// schedule and daypage are a thing."
//
// These are things assembled FROM the capabilities in features.js — the same
// relationship the application itself keeps, where no renderer knows what a
// schedule is and the seed authors one as data. Each record names the generic
// capabilities it is built from, so the page can show the join.

export const EXAMPLES = [
  {
    id: "day-timeline",
    name: "A day on a timeline",
    blurb: "Drag what you plan to do into the hours of the day. The same rows are the plan and the record of what happened.",
    detail:
      "Half-hour slots down a column, each one a container you can drop into. Because a placed row carries its own values, ticking it off and writing down how long it took are the same action — there is no separate log to reconcile at the end of the day. Move a row to another hour and it keeps everything it was carrying.",
    built: ["build", "measure", "operations"],
  },
  {
    id: "day-page",
    name: "A page per day",
    blurb: "A journal, a question to answer, notes, and what you finished — rebuilt for each new day from a template you control.",
    detail:
      "One column per day, each holding the sections you decided a day should have. A template supplies the shape; edit the template and days that already exist are topped up with what it gained, without touching anything you wrote. Yesterday stays exactly as you left it.",
    built: ["build", "intake", "operations"],
  },
  {
    id: "trackers",
    name: "Trackers",
    blurb: "Totals that keep themselves up to date — how much, how many, how long, how often.",
    detail:
      "A tracker is an operation with somewhere to put its answer. It finds the records that qualify, adds up the part you care about, and writes the total where you can see it. Because you wrote the rule, you can change what qualifies — this week only, one category, only the ones you finished.",
    built: ["measure", "operations", "visualize"],
  },
  {
    id: "goals",
    name: "Goals and streaks",
    blurb: "A target, the distance to it, and how many days in a row you have got there.",
    detail:
      "The same machinery as a tracker with a target beside it, so progress is a comparison rather than a number you have to interpret. Targets scale to the window you are looking at, and a streak is one of the verbs — nothing had to be special-cased to count consecutive days.",
    built: ["measure", "operations", "visualize"],
  },
];
