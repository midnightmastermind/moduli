#!/usr/bin/env node
// scripts/cleanSeedModules.js
// Removes modules with invalid _id values from seed/modules.json
// and populates the daily template items in seed/grids.json

import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const seedDir = resolve(__dirname, "../seed");

// ========== Fix modules.json ==========
const modulesPath = resolve(seedDir, "modules.json");
const raw = fs.readFileSync(modulesPath, "utf-8");

// The file may be broken JSON — find the valid portion by parsing line-by-line
// Strategy: find the `]` that closes the array before the invalid content
let lines = raw.split("\n");

// Find all module objects and filter out ones with invalid _id
// First, reconstruct valid JSON by finding module boundaries
let validModules = [];
let current = "";
let depth = 0;
let inArray = false;

for (const line of lines) {
  const trimmed = line.trim();
  if (trimmed === "[") { inArray = true; continue; }
  if (trimmed === "]") { break; }
  // Skip lines after a premature ]
  if (!inArray) continue;

  current += line + "\n";

  // Track braces
  for (const ch of trimmed) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
  }

  // When depth returns to 0, we have a complete object
  if (depth === 0 && current.trim().length > 0) {
    // Clean trailing comma
    let obj = current.trim();
    if (obj.endsWith(",")) obj = obj.slice(0, -1);
    if (obj.length > 2) {
      try {
        const parsed = JSON.parse(obj);
        // Only keep modules with valid 24-char hex _id
        if (parsed._id && /^[0-9a-f]{24}$/.test(parsed._id)) {
          validModules.push(parsed);
        } else {
          console.log(`  Removing invalid module: _id="${parsed._id}" label="${parsed.label}"`);
        }
      } catch (e) {
        console.log(`  Skipping unparseable block: ${obj.slice(0, 80)}...`);
      }
    }
    current = "";
  }
}

console.log(`\nKept ${validModules.length} valid modules`);
fs.writeFileSync(modulesPath, JSON.stringify(validModules, null, 2));
console.log("✅ modules.json cleaned\n");

// ========== Fix grids.json daily template ==========
const gridsPath = resolve(seedDir, "grids.json");
const grids = JSON.parse(fs.readFileSync(gridsPath, "utf-8"));
const grid = grids[0];

// On-the-hour timeslot module IDs (24 slots, 12:00am through 11:00pm)
const hourlySlotIds = [
  "VAx7XmkKkMz2", // 12:00am
  "b4C533sa0wrN", // 1:00am
  "XtLydhCvMlEe", // 2:00am
  "o8ztM7YCMeE6", // 3:00am
  "TqQQNfzLRG7l", // 4:00am
  "OnmFrcg76E40", // 5:00am
  "W1GNd5QlL7UH", // 6:00am
  "82QQUyYYPEo9", // 7:00am
  "aoD9eTTcL9uR", // 8:00am
  "N1-TtWW32ab3", // 9:00am
  "qGkqJaeHsGDK", // 10:00am
  "pWL_h1Q6Qake", // 11:00am
  "tESSlU3Jycwq", // 12:00pm
  "pxu6sIasmOBt", // 1:00pm
  "5mH3o0ebGro1", // 2:00pm
  "XFDCl773NZdR", // 3:00pm
  "hhrrzQrWQNph", // 4:00pm
  "hk1wUiizGlI_", // 5:00pm
  "qJlJ8Ce7_3qh", // 6:00pm
  "tuRAWyqR-t40", // 7:00pm
  "weRyhTtwc9dk", // 8:00pm
  "tBOQey7O1HKH", // 9:00pm
  "N6hGtAA_6VcU", // 10:00pm
  "Zr9K83rJmA6e", // 11:00pm
];

// Find or update the daily template
const dailyTmpl = grid.templates?.find(t => t.id === "tmpl_daily_24h");
if (dailyTmpl) {
  dailyTmpl.items = hourlySlotIds.map(id => ({ instanceId: id }));
  console.log(`Updated daily template with ${hourlySlotIds.length} hourly slots`);
} else {
  console.log("Daily template not found in grids.json");
}

fs.writeFileSync(gridsPath, JSON.stringify(grids, null, 2));
console.log("✅ grids.json updated\n");

console.log("Done! Now run: node scripts/loadSeedData.js");
