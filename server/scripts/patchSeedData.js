#!/usr/bin/env node
// scripts/patchSeedData.js
// Patches seed JSON files to add scheduledDate + timeslot fields
// to schedule container occurrences and their child instance occurrences.
// Also adds daily (24h), weekly (7-day), and monthly (31-day) templates.
//
// Usage: node scripts/patchSeedData.js

import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

// Generate valid 24-char hex ObjectId strings
const genId = () => crypto.randomBytes(12).toString("hex");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const seedDir = resolve(__dirname, "../seed");

// Field IDs (from seed/fields.json)
const SCHEDULED_DATE_FIELD_ID = "QnrA81e_JnJt";
const TIMESLOT_FIELD_ID = "8nbH0j9SHmMS";

// Load seed files
const modules = JSON.parse(fs.readFileSync(resolve(seedDir, "modules.json"), "utf-8"));
const occurrences = JSON.parse(fs.readFileSync(resolve(seedDir, "occurrences.json"), "utf-8"));
const grids = JSON.parse(fs.readFileSync(resolve(seedDir, "grids.json"), "utf-8"));

// Build lookup maps
const moduleById = {};
for (const m of modules) moduleById[m.id] = m;

const occById = {};
for (const o of occurrences) occById[o.id] = o;

// Today's date for scheduledDate values
const today = new Date();
today.setHours(0, 0, 0, 0);
const todayISO = today.toISOString();

// ========== STEP 1: Find schedule time slot container modules ==========
// These are containers with labels like "6:00 AM", "7:00 AM", etc.
const timeSlotPattern = /^\d{1,2}:\d{2}\s*(am|pm|AM|PM)$/i;
const scheduleContainerModules = modules.filter(m =>
  m.role === "container" && timeSlotPattern.test(m.label)
);

console.log(`Found ${scheduleContainerModules.length} schedule time slot container modules:`);
for (const m of scheduleContainerModules) {
  console.log(`  - ${m.label} (${m.id})`);
}

// ========== STEP 2: Find occurrences of those containers and patch fields ==========
const scheduleContainerModuleIds = new Set(scheduleContainerModules.map(m => m.id));
let containerOccsPatched = 0;
let instanceOccsPatched = 0;

for (const occ of occurrences) {
  // Check if this is a schedule container occurrence
  if (occ.targetType === "module" && scheduleContainerModuleIds.has(occ.targetId)) {
    const mod = moduleById[occ.targetId];
    if (!occ.fields) occ.fields = {};

    // Add scheduledDate (today)
    if (!occ.fields[SCHEDULED_DATE_FIELD_ID]) {
      occ.fields[SCHEDULED_DATE_FIELD_ID] = { value: todayISO, flow: "in" };
    }

    // Add timeslot (container label, e.g. "6:00 AM")
    if (!occ.fields[TIMESLOT_FIELD_ID]) {
      occ.fields[TIMESLOT_FIELD_ID] = { value: mod.label, flow: "in" };
    }

    containerOccsPatched++;

    // Now patch child instance occurrences
    if (occ.occurrences && occ.occurrences.length > 0) {
      for (const childId of occ.occurrences) {
        const childOcc = occById[childId];
        if (!childOcc) continue;
        if (!childOcc.fields) childOcc.fields = {};

        // Add timeslot matching the container
        if (!childOcc.fields[TIMESLOT_FIELD_ID]) {
          childOcc.fields[TIMESLOT_FIELD_ID] = { value: mod.label, flow: "in" };
        }

        instanceOccsPatched++;
      }
    }
  }
}

console.log(`\nPatched ${containerOccsPatched} container occurrences with scheduledDate + timeslot`);
console.log(`Patched ${instanceOccsPatched} instance occurrences with timeslot`);

// ========== STEP 3: Also patch historical occurrences ==========
// Historical occurrences may have scheduledDate already but might lack timeslot.
// Walk ALL occurrences and if they have a scheduledDate field value but no timeslot,
// check if their parent is a schedule container and inherit timeslot.
let historicalPatched = 0;
for (const occ of occurrences) {
  if (!occ.fields) continue;
  if (occ.fields[SCHEDULED_DATE_FIELD_ID] && !occ.fields[TIMESLOT_FIELD_ID]) {
    // Check parent chain for schedule container
    const parent = occ.parentId ? occById[occ.parentId] : null;
    if (parent && parent.targetType === "module" && scheduleContainerModuleIds.has(parent.targetId)) {
      const parentMod = moduleById[parent.targetId];
      occ.fields[TIMESLOT_FIELD_ID] = { value: parentMod.label, flow: "in" };
      historicalPatched++;
    }
  }
}
console.log(`Patched ${historicalPatched} historical occurrences with inherited timeslot`);

// ========== STEP 4: Add templates to grid ==========
const grid = grids[0];
if (!grid.templates) grid.templates = [];

// Check if templates already exist
const existingNames = new Set(grid.templates.map(t => t.name));

// Daily template: 24 hour containers (12:00 AM through 11:00 PM)
if (!existingNames.has("Daily Schedule (24h)")) {
  const dailyItems = [];
  for (let h = 0; h < 24; h++) {
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const ampm = h < 12 ? "am" : "pm";
    const label = `${hour12}:00${ampm}`;
    // Find existing module for this slot
    const mod = scheduleContainerModules.find(m => m.label === label);
    if (mod) {
      dailyItems.push({ instanceId: mod.id });
    }
  }
  grid.templates.push({
    id: "tmpl_daily_24h",
    name: "Daily Schedule (24h)",
    items: dailyItems,
    createdAt: new Date().toISOString(),
    _id: genId()
  });
  console.log(`\nAdded "Daily Schedule (24h)" template with ${dailyItems.length} slots`);
}

// Weekly template: 7 day containers (Monday through Sunday)
if (!existingNames.has("Weekly Schedule (7 days)")) {
  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const weeklyModules = [];

  for (const dayName of dayNames) {
    // Check if module exists
    let mod = modules.find(m => m.role === "container" && m.label === dayName);
    if (!mod) {
      // Create new container module for this day
      const newId = `wkday_${dayName.toLowerCase().slice(0, 3)}`;
      mod = {
        _id: genId(),
        id: newId,
        userId: "{{USER_ID}}",
        gridId: grid._id,
        role: "container",
        kind: "list",
        label: dayName,
        fileRef: null,
        iteration: { mode: "inherit", timeFilter: "daily" },
        defaultDragMode: "move",
        fieldBindings: [
          { fieldId: SCHEDULED_DATE_FIELD_ID, order: 0, hidden: true, _id: genId() },
          { fieldId: TIMESLOT_FIELD_ID, order: 1, hidden: true, _id: genId() }
        ],
        styleMode: "inherit",
        ownStyle: null,
        defaultInstanceStyle: null,
        siblingLinks: [],
        defaultTemplateId: null,
        behaviorMode: "inherit",
        behavior: { sortable: true, draggable: true, droppable: true },
        splitPartnerId: null,
        customCss: "",
        trashed: false,
        operationBindings: [],
        layout: {},
        meta: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      modules.push(mod);
      moduleById[mod.id] = mod;
    }
    weeklyModules.push(mod);
  }

  grid.templates.push({
    id: "tmpl_weekly_7d",
    name: "Weekly Schedule (7 days)",
    items: weeklyModules.map(m => ({ instanceId: m.id })),
    createdAt: new Date().toISOString(),
    _id: genId()
  });
  console.log(`Added "Weekly Schedule (7 days)" template with 7 day containers`);
}

// Monthly template: 31 day containers (Day 1 through Day 31)
if (!existingNames.has("Monthly Schedule (31 days)")) {
  const monthlyModules = [];

  for (let d = 1; d <= 31; d++) {
    const label = `Day ${d}`;
    let mod = modules.find(m => m.role === "container" && m.label === label);
    if (!mod) {
      const newId = `moday_${d}`;
      mod = {
        _id: genId(),
        id: newId,
        userId: "{{USER_ID}}",
        gridId: grid._id,
        role: "container",
        kind: "list",
        label: label,
        fileRef: null,
        iteration: { mode: "inherit", timeFilter: "monthly" },
        defaultDragMode: "move",
        fieldBindings: [
          { fieldId: SCHEDULED_DATE_FIELD_ID, order: 0, hidden: true, _id: genId() },
          { fieldId: TIMESLOT_FIELD_ID, order: 1, hidden: true, _id: genId() }
        ],
        styleMode: "inherit",
        ownStyle: null,
        defaultInstanceStyle: null,
        siblingLinks: [],
        defaultTemplateId: null,
        behaviorMode: "inherit",
        behavior: { sortable: true, draggable: true, droppable: true },
        splitPartnerId: null,
        customCss: "",
        trashed: false,
        operationBindings: [],
        layout: {},
        meta: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      modules.push(mod);
      moduleById[mod.id] = mod;
    }
    monthlyModules.push(mod);
  }

  grid.templates.push({
    id: "tmpl_monthly_31d",
    name: "Monthly Schedule (31 days)",
    items: monthlyModules.map(m => ({ instanceId: m.id })),
    createdAt: new Date().toISOString(),
    _id: genId()
  });
  console.log(`Added "Monthly Schedule (31 days)" template with 31 day containers`);
}

// ========== STEP 5: Write back ==========
fs.writeFileSync(resolve(seedDir, "modules.json"), JSON.stringify(modules, null, 2));
fs.writeFileSync(resolve(seedDir, "occurrences.json"), JSON.stringify(occurrences, null, 2));
fs.writeFileSync(resolve(seedDir, "grids.json"), JSON.stringify(grids, null, 2));

console.log("\n✅ Seed data patched successfully!");
console.log("   Run: node scripts/loadSeedData.js");
