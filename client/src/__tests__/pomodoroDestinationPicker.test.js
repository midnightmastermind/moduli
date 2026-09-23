// THE POMODORO DESTINATION PICKER COULD NOT BE USED AT ALL.
//
// `DestinationPicker` is a Radix Popover: its list portals to `document.body`,
// a SIBLING of the pomodoro panel rather than a descendant. The panel's own
// dismiss handler asked `panelRef.current.contains(e.target)`, which is a lie
// for a portalled layer, so pressing a destination row collapsed the panel —
// on MOUSEDOWN — and `containerOptions` is memoized on `expanded`, so the list
// emptied before the click completed. Measured on prod 2026-09-22:
//
//     picker open             popover open   rows 33
//     after MOUSEDOWN only    popover open   rows  0    <- panel collapsed
//     after mouseup           popover open   rows  0    <- onPick never fired
//
// Two decisions that are each correct alone and cancel each other out. The
// consequence is not cosmetic: `grid.meta.pomodoroTargetContainerId` is unset
// on poms grid too, because there has never been a way to set it.
//
// `helpers/outsideClick.clickedInsidePortalLayer` is the rule this app already
// wrote for exactly this symptom (2026-08-27, QuickAdd closing when you picked
// an option from a dropdown it hosts). The fix is to USE it.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..");
const read = (rel) => readFileSync(path.join(SRC, ...rel.split("/")), "utf8");

// Comments NAME both the rule and the components, and a guard that greps raw
// text passes on the prose explaining why the rule is missing — the
// `noDomainKnowledge` trap this repo records from the CSS side. Strip them.
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "node_modules") continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(name)) out.push(p);
  }
  return out;
};

describe("a panel that hosts a portalling picker honours portalled clicks", () => {
  it("PomodoroTimer checks the portal rule BEFORE its containment test", () => {
    const src = stripComments(read("ui/PomodoroTimer.jsx"));

    // CONTROLS — without these, "it uses the rule" also passes against a build
    // that deleted the picker, deleted the dismiss handler, or removed the
    // `expanded` gate (any of which would "fix" the symptom by removing a
    // feature rather than the defect).
    expect(src, "the destination picker is gone").toContain("<DestinationPicker");
    expect(src, "the dismiss-on-outside-click handler is gone")
      .toMatch(/addEventListener\("mousedown"/);
    expect(src, "containerOptions no longer builds only while expanded")
      .toMatch(/expanded\s*\?\s*buildContainerCrumbOptions/);

    expect(src).toContain("clickedInsidePortalLayer");

    // Ordering is the whole fix: the portal check must SHORT-CIRCUIT the
    // containment test, not sit after it where the collapse already happened.
    const guard = src.indexOf("clickedInsidePortalLayer(e.target)");
    const contains = src.indexOf("panelRef.current?.contains(e.target)");
    expect(guard, "the portal guard is not in the handler").toBeGreaterThan(-1);
    expect(contains).toBeGreaterThan(-1);
    expect(guard, "the portal check must run before the containment test")
      .toBeLessThan(contains);
  });

  // THE WALKER IS THE MEASUREMENT. A hand grep over this tree has already
  // under-reported once in this project (2026-09-22, the raw-socket audit),
  // and the whole point of this defect is that it was missed in one file while
  // eight others got it right.
  it("every component hosting a portalling picker uses the shared rule", () => {
    const PORTALLING = /<(DestinationPicker|DrilldownPicker)\b/;
    const offenders = [];
    let hosts = 0;
    for (const file of walk(SRC)) {
      const raw = readFileSync(file, "utf8");
      const src = stripComments(raw);
      if (!PORTALLING.test(src)) continue;
      if (!/addEventListener\("mousedown"/.test(src)) continue;
      hosts++;
      // A CALL, not merely the import — a file that imports the rule and
      // never calls it is exactly as broken, and an identifier check passes
      // on the import line alone (proved by A/B).
      if (!/clickedInsidePortalLayer\s*\(/.test(src)) {
        offenders.push(path.relative(SRC, file));
      }
    }
    // A zero from a walker that matched nothing is not a measurement.
    expect(hosts, "the walker found no hosts at all — its selectors are wrong")
      .toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
