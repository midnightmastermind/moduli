// Pretty-print op run logs from a browser-downloaded JSON file. The
// browser keeps run history in memory (executor's `runHistory`, capped
// at 20 per op); when you want to send them to me, run
// `__moduli_download_runs()` in the devtools console → file downloads to
// ~/Downloads/moduli-runs-<timestamp>.json → this script reads it. No
// wire persistence, no Mongo writes, no per-op overhead.
//
// Usage:
//   # latest dump in ~/Downloads, pretty text
//   node server/scripts/dumpOpRunLogs.js
//
//   # explicit path
//   node server/scripts/dumpOpRunLogs.js ~/Downloads/moduli-runs-2026-05-26.json
//
//   # JSON to stdout (paste to me)
//   node server/scripts/dumpOpRunLogs.js --json > runs.json
//
//   # one op only
//   node server/scripts/dumpOpRunLogs.js --op="Table: Build"
//
//   # stdin
//   cat dump.json | node server/scripts/dumpOpRunLogs.js -
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const argv = process.argv.slice(2);
const wantJson = argv.includes("--json");
const opFlag = argv.find(a => a.startsWith("--op="));
const opFilter = opFlag ? opFlag.split("=")[1] : null;
const pathArg = argv.filter(a => !a.startsWith("--"))[0];

// Resolve input path: explicit > stdin > newest moduli-runs-*.json in ~/Downloads
let raw;
if (pathArg === "-") {
  raw = fs.readFileSync(0, "utf8");
} else if (pathArg) {
  raw = fs.readFileSync(pathArg, "utf8");
} else {
  const downloads = path.join(os.homedir(), "Downloads");
  let candidates = [];
  try {
    candidates = fs.readdirSync(downloads)
      .filter(f => f.startsWith("moduli-runs-") && f.endsWith(".json"))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(downloads, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch (err) {
    console.error(`Cannot read ${downloads}: ${err.message}`);
    process.exit(1);
  }
  if (candidates.length === 0) {
    console.error(`No moduli-runs-*.json files in ${downloads}.`);
    console.error("Run __moduli_download_runs() in the browser console first.");
    process.exit(1);
  }
  const newest = path.join(downloads, candidates[0].name);
  console.error(`Reading: ${newest}`);
  if (candidates.length > 1) console.error(`(${candidates.length - 1} older dump${candidates.length === 2 ? "" : "s"} also present)`);
  raw = fs.readFileSync(newest, "utf8");
}

let dump;
try {
  dump = JSON.parse(raw);
} catch (err) {
  console.error(`Invalid JSON: ${err.message}`);
  process.exit(1);
}

// dump shape: { [opName]: { opId, opName, totalRunsInMemory, runs: [...] } }
const entries = Object.entries(dump);
const filtered = opFilter
  ? entries.filter(([name]) => name.toLowerCase().includes(opFilter.toLowerCase()))
  : entries;

if (wantJson) {
  process.stdout.write(JSON.stringify(Object.fromEntries(filtered), null, 2));
  process.exit(0);
}

if (filtered.length === 0) {
  console.log(opFilter ? `No ops match "${opFilter}".` : "Dump is empty.");
  process.exit(0);
}

for (const [opName, data] of filtered) {
  const runs = Array.isArray(data?.runs) ? data.runs : [];
  console.log(`══════════════════════════════════════════════════════════════════`);
  console.log(`OP: ${opName}   ${runs.length} run(s)   (in-memory total: ${data?.totalRunsInMemory ?? runs.length})`);
  console.log(`══════════════════════════════════════════════════════════════════`);

  for (const run of runs) {
    const triggerLabel = run.transactionType || "?";
    const triggerOcc = run.trigger?.occurrenceId ? ` occ=${String(run.trigger.occurrenceId).slice(0, 8)}` : "";
    console.log(`\n  ${run.runAt}   ${run.durationMs}ms   trigger=${triggerLabel}${triggerOcc}`);

    const entries = Array.isArray(run.entries) ? run.entries : [];
    let actions = 0, ifs = 0, loops = 0, creates = 0, deletes = 0, copyLinks = 0;
    const finds = [];
    for (const e of entries) {
      if (e.kind === "action") {
        actions++;
        const t = e.action?.config?.type;
        if (t === "CREATE") creates++;
        else if (t === "DELETE") deletes++;
        else if (t === "COPY_LINK") copyLinks++;
        else if (t === "FIND") finds.push({ vars: e.action?.boundVars, predicate: e.resolvedPredicate });
      } else if (e.kind === "if") ifs++;
      else if (e.kind === "loop") loops++;
    }
    console.log(`    actions=${actions} (CREATE=${creates} DELETE=${deletes} COPY_LINK=${copyLinks}) ifs=${ifs} loops=${loops}`);

    if (finds.length) {
      console.log(`    FIND results:`);
      for (const f of finds.slice(0, 8)) {
        const bv = f.vars
          ? Object.entries(f.vars).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ")
          : "(no boundVars)";
        console.log(`      ${bv}`);
      }
      if (finds.length > 8) console.log(`      … ${finds.length - 8} more`);
    }

    const endEntry = entries.find(e => e.kind === "end");
    if (endEntry?.updates) {
      const effCounts = {};
      for (const u of endEntry.updates) {
        const k = u._effect || "(display)";
        effCounts[k] = (effCounts[k] || 0) + 1;
      }
      const summary = Object.entries(effCounts).map(([k, v]) => `${k}=${v}`).join(" ") || "(no effects)";
      console.log(`    effects: ${summary}`);
    }
  }
  console.log();
}
