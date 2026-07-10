// scripts/dumpOccurrenceTree.js
// ============================================================
// Read-only. Renders the live grid's occurrence tree as a Markdown outline
// GROUPED BY PAGE: each page is a top-level section, with its contents nested
// by containment (each occurrence's ordered occurrences[] array). Child pages
// (folder pages, page-in-page) get their own section and are referenced, not
// re-expanded. Annotates role/kind, flags feed copies (meta.feedSourceId) and
// multi-parent revisits.
// Usage: node scripts/dumpOccurrenceTree.js
// ============================================================

import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "../.env") });

import Grid from "../models/Grid.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import User from "../models/User.js";

const TARGET_USER_EMAIL = "josh@jpoms.com";

function esc(s) {
  return String(s ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const user = await User.findOne({ email: TARGET_USER_EMAIL });
  if (!user) throw new Error(`User not found: ${TARGET_USER_EMAIL}`);
  const userId = user._id.toString();

  const grids = await Grid.find({ userId }).lean();
  const modules = await Module.find({ userId }).lean();
  const occs = await Occurrence.find({ userId }).lean();

  const idOf = (d) => d.id || d._id.toString();
  const modById = new Map(modules.map((m) => [idOf(m), m]));
  const occById = new Map(occs.map((o) => [idOf(o), o]));

  let grid =
    grids.find((g) => /live/i.test(g.name || "")) ||
    grids.slice().sort((a, b) => (b.occurrences?.length || 0) - (a.occurrences?.length || 0))[0];
  if (!grid) throw new Error("No grid found");
  const gridId = idOf(grid);

  const gridOccs = occs.filter((o) => o.gridId === gridId);
  const gridOccIds = new Set(gridOccs.map(idOf));

  const modOf = (occ) => modById.get(occ.moduleId);
  const roleOf = (occ) => modOf(occ)?.role || "?";
  const isPage = (occ) => roleOf(occ) === "page";
  const labelFor = (occ) => {
    const mod = modOf(occ);
    return esc(occ.label || mod?.label || "(untitled)");
  };
  const annot = (occ) => {
    const mod = modOf(occ);
    const role = mod?.role || "?";
    return `${role}${mod?.kind ? ` · ${mod.kind}` : ""}`;
  };
  const childrenOf = (occ) => (occ.occurrences || []).filter((c) => occById.has(c));

  // ---- roots (nothing lists them as a child) → for a natural page order ----
  const referencedAsChild = new Set();
  for (const o of gridOccs) for (const c of o.occurrences || []) referencedAsChild.add(c);
  const roots = gridOccs.filter((o) => !referencedAsChild.has(idOf(o)));

  // DFS from roots → page occurrences in encounter order + each page's
  // breadcrumb (chain of enclosing page/panel labels).
  const pageOrder = [];
  const seenPage = new Set();
  const crumbOf = new Map();
  function collectPages(id, crumb, anc) {
    if (anc.has(id)) return;
    const occ = occById.get(id);
    if (!occ) return;
    const na = new Set(anc); na.add(id);
    const role = roleOf(occ);
    let nextCrumb = crumb;
    if (isPage(occ)) {
      if (!seenPage.has(id)) {
        seenPage.add(id);
        pageOrder.push(id);
        crumbOf.set(id, crumb.slice());
      }
      nextCrumb = [...crumb, labelFor(occ)];
    } else if (role === "panel") {
      nextCrumb = [...crumb, labelFor(occ)];
    }
    for (const c of childrenOf(occ)) collectPages(c, nextCrumb, na);
  }
  for (const r of roots) collectPages(idOf(r), [], new Set());
  // Any pages never encountered from a root (detached) — append at the end.
  for (const o of gridOccs) if (isPage(o) && !seenPage.has(idOf(o))) { seenPage.add(idOf(o)); pageOrder.push(idOf(o)); crumbOf.set(idOf(o), []); }

  // ---------------------------------------------------------------------------
  const lines = [];
  lines.push(`# Live Grid — Occurrence Tree (by page)`);
  lines.push("");
  lines.push(`_Generated ${new Date().toISOString().slice(0, 10)} from the live database (read-only)._`);
  lines.push("");
  lines.push(`**Grid:** ${esc(grid.name || "(unnamed)")} · **pages:** ${pageOrder.length} · **occurrences on grid:** ${gridOccs.length}`);
  lines.push("");
  lines.push(`Each page below is a top-level section; its contents are nested by containment (following each occurrence's ordered \`occurrences[]\`). \`(role · kind)\` annotates every node. **Ⓕ** = feed copy (\`meta.feedSourceId\`, a copy-linked mirror). **↩︎ shared** = already shown above in this branch (multi-parented, e.g. schedule slots shared into day columns). A nested page shows as **↳ page → see its section** rather than re-expanding.`);
  lines.push("");

  let nodeCount = 0;
  let feedCount = 0;
  const shownInAPage = new Set();

  // Walk the subtree UNDER a page section. Stops descending into nested pages
  // (they get their own section).
  function walk(occId, depth, ancestry, ownerPageId) {
    const occ = occById.get(occId);
    if (!occ) { lines.push(`${"  ".repeat(depth)}- _[missing ${esc(occId)}]_`); return; }
    const indent = "  ".repeat(depth);
    const isFeed = !!occ.meta?.feedSourceId;
    const feedTag = isFeed ? " Ⓕ" : "";

    if (ancestry.has(occId)) {
      lines.push(`${indent}- **${labelFor(occ)}** \`(${annot(occ)})\`${feedTag} ↩︎ shared`);
      return;
    }
    // A nested page (not the section owner) → reference only.
    if (isPage(occ) && occId !== ownerPageId) {
      lines.push(`${indent}- ↳ **${labelFor(occ)}** \`(${annot(occ)})\` → see its section`);
      return;
    }

    if (isFeed) feedCount++;
    nodeCount++;
    shownInAPage.add(occId);
    const kids = childrenOf(occ);
    const note = kids.length ? ` — ${kids.length} child${kids.length === 1 ? "" : "ren"}` : "";
    lines.push(`${indent}- **${labelFor(occ)}** \`(${annot(occ)})\`${feedTag}${note}`);
    const na = new Set(ancestry); na.add(occId);
    for (const c of kids) walk(c, depth + 1, na, ownerPageId);
  }

  for (const pid of pageOrder) {
    const page = occById.get(pid);
    const crumb = crumbOf.get(pid) || [];
    lines.push(`## ${labelFor(page)}`);
    const ctx = crumb.length ? crumb.join(" › ") : "(top level)";
    lines.push(`\`${annot(page)}\` · location: ${esc(ctx)}`);
    lines.push("");
    const kids = childrenOf(page);
    if (!kids.length) {
      lines.push(`_(empty)_`);
    } else {
      for (const c of kids) walk(c, 0, new Set([pid]), pid);
    }
    lines.push("");
  }

  lines.push(`---`);
  lines.push(`_${pageOrder.length} pages · ${nodeCount} content nodes rendered · ${feedCount} feed copies (Ⓕ)._`);

  const outPath = resolve(__dirname, "../../LIVE_GRID_TREE.md");
  fs.writeFileSync(outPath, lines.join("\n"));
  console.log(`Wrote ${outPath} — ${pageOrder.length} pages, ${nodeCount} nodes, ${feedCount} feed copies.`);
  console.log(`Grids: ${grids.map((g) => `${g.name || "(unnamed)"}[${g.occurrences?.length || 0}p]`).join(", ")}`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
