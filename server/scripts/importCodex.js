// scripts/importCodex.js
// ============================================================
// Imports codex + notes_codex_annotated files as doc pages into the DB.
// Creates Folder tree mirroring the directory structure, then creates
// Module + Occurrence records for each file with parsed textmap.
//
// Usage: cd server && node scripts/importCodex.js
// ============================================================

import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve, relative, basename, extname } from "path";
import fs from "fs";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "../.env") });

import Grid from "../models/Grid.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import View from "../models/View.js";
import Manifest from "../models/Manifest.js";
import Folder from "../models/Folder.js";
import User from "../models/User.js";

const MONGO_URI = process.env.MONGO_URI;
const TARGET_USER_EMAIL = "josh@jpoms.com";
const PROJECT_ROOT = resolve(__dirname, "../..");
const CSV_PATH = resolve(PROJECT_ROOT, "import_tracking.csv");

const uid = () => crypto.randomUUID();

// ─── TipTap Helpers (inline from docBuilders) ────────────────

function inlineToTipTap(text) {
  const nodes = [];
  const regex = /(\*{3}|\*{2}|\*)([^*]+)\1/g;
  let lastIndex = 0;
  for (const match of text.matchAll(regex)) {
    if (match.index > lastIndex)
      nodes.push({ type: "text", text: text.slice(lastIndex, match.index) });
    const marks = [];
    const len = match[1].length;
    if (len === 2 || len === 3) marks.push({ type: "bold" });
    if (len === 1 || len === 3) marks.push({ type: "italic" });
    nodes.push(marks.length ? { type: "text", text: match[2], marks } : { type: "text", text: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push({ type: "text", text: text.slice(lastIndex) });
  return nodes.length ? nodes : [{ type: "text", text: text || "" }];
}

function makeDocContent(lines) {
  const nodes = [];
  let bulletItems = [];
  function flushBullets() {
    if (!bulletItems.length) return;
    nodes.push({
      type: "bulletList",
      content: bulletItems.map(item => ({
        type: "listItem",
        content: [{ type: "paragraph", content: inlineToTipTap(item) }],
      })),
    });
    bulletItems = [];
  }
  let numberedItems = [];
  function flushNumbered() {
    if (!numberedItems.length) return;
    nodes.push({
      type: "orderedList",
      content: numberedItems.map(item => ({
        type: "listItem",
        content: [{ type: "paragraph", content: inlineToTipTap(item) }],
      })),
    });
    numberedItems = [];
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "---") { flushBullets(); flushNumbered(); continue; }
    const bulletMatch = trimmed.match(/^[*-]\s+(.+)/);
    if (bulletMatch) { flushNumbered(); bulletItems.push(bulletMatch[1]); continue; }
    const numMatch = trimmed.match(/^\d+\.\s+(.+)/);
    if (numMatch) { flushBullets(); numberedItems.push(numMatch[1]); continue; }
    flushBullets();
    flushNumbered();
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      nodes.push({ type: "heading", attrs: { level: headingMatch[1].length }, content: inlineToTipTap(headingMatch[2]) });
      continue;
    }
    // Blockquote lines (but NOT annotations — those are handled separately)
    if (trimmed.startsWith("> ") && !trimmed.includes("[annotation]")) {
      nodes.push({
        type: "blockquote",
        content: [{ type: "paragraph", content: inlineToTipTap(trimmed.slice(2)) }],
      });
      continue;
    }
    const content = inlineToTipTap(trimmed);
    if (content.some(n => n.text)) nodes.push({ type: "paragraph", content });
  }
  flushBullets();
  flushNumbered();
  if (!nodes.length) nodes.push({ type: "paragraph", content: [{ type: "text", text: "" }] });
  return { type: "doc", content: nodes };
}

// ─── Annotated File Parser ───────────────────────────────────

function parseAnnotatedSections(content) {
  // Split by --- dividers. Each section may contain content + annotation.
  const rawSections = content.split(/\n---\n/);
  const sections = [];

  for (const rawSection of rawSections) {
    const trimmed = rawSection.trim();
    if (!trimmed) continue;

    // Find annotation blocks: > **[annotation]** ...
    // An annotation can span multiple lines starting with >
    const lines = trimmed.split("\n");
    const contentLines = [];
    const annotationLines = [];
    let inAnnotation = false;

    for (const line of lines) {
      if (line.trim().startsWith("> **[annotation]**")) {
        inAnnotation = true;
        // Strip the "> **[annotation]** " prefix
        const text = line.trim().replace(/^>\s*\*\*\[annotation\]\*\*\s*/, "");
        if (text) annotationLines.push(text);
      } else if (inAnnotation && line.trim().startsWith(">")) {
        // Continuation of annotation blockquote
        annotationLines.push(line.trim().replace(/^>\s*/, ""));
      } else if (inAnnotation && line.trim() === "") {
        // Blank line might end annotation, but could also be part of it
        inAnnotation = false;
      } else {
        inAnnotation = false;
        contentLines.push(line);
      }
    }

    // Skip tag-only sections (lines that are just hashtags)
    const meaningfulContent = contentLines.filter(l => l.trim() && !l.trim().match(/^#[\w-]+(\s+#[\w-]+)*$/));
    if (!meaningfulContent.length && !annotationLines.length) continue;

    // Extract heading from content if present
    let heading = null;
    const firstMeaningful = contentLines.find(l => l.trim());
    if (firstMeaningful) {
      const hMatch = firstMeaningful.trim().match(/^(#{1,6})\s+(.+)/);
      if (hMatch) heading = hMatch[2];
    }

    sections.push({
      heading,
      contentLines,
      annotationText: annotationLines.join(" "),
    });
  }

  return sections;
}

// ─── Codex File Parser ───────────────────────────────────────

function parseCodexSections(content) {
  // Split by headings (## or #) or === dividers
  const lines = content.split("\n");
  const sections = [];
  let currentLines = [];
  let currentHeading = null;

  function flush() {
    if (currentLines.length || currentHeading) {
      const meaningful = currentLines.filter(l => l.trim());
      if (meaningful.length || currentHeading) {
        sections.push({ heading: currentHeading, contentLines: [...currentLines] });
      }
    }
    currentLines = [];
    currentHeading = null;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    // === divider
    if (trimmed.match(/^={3,}$/)) { flush(); continue; }
    // Heading
    const hMatch = trimmed.match(/^(#{1,3})\s+(.+)/);
    if (hMatch) {
      flush();
      currentHeading = hMatch[2];
      continue;
    }
    currentLines.push(line);
  }
  flush();

  // If no sections found, treat whole content as one section
  if (!sections.length && content.trim()) {
    sections.push({ heading: null, contentLines: content.split("\n") });
  }

  return sections;
}

// ─── CSV Helpers ─────────────────────────────────────────────

// CSV with proper quoting for fields that contain commas
function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (line[i] === "," && !inQuotes) {
      fields.push(current); current = "";
    } else {
      current += line[i];
    }
  }
  fields.push(current);
  return fields;
}

function csvQuote(val) {
  if (val.includes(",") || val.includes('"') || val.includes("\n"))
    return `"${val.replace(/"/g, '""')}"`;
  return val;
}

function readCsv() {
  const raw = fs.readFileSync(CSV_PATH, "utf-8");
  const lines = raw.split("\n");
  const header = lines[0];
  const rows = lines.slice(1).filter(l => l.trim()).map(l => {
    const parts = parseCsvLine(l);
    return {
      file_path: parts[0] || "",
      folder: parts[1] || "",
      source: parts[2] || "",
      status: parts[3] || "",
      notes: parts[4] || "",
    };
  });
  return { header, rows };
}

function writeCsv(header, rows) {
  const lines = [header];
  for (const r of rows) {
    lines.push([r.file_path, r.folder, r.source, r.status, r.notes].map(csvQuote).join(","));
  }
  fs.writeFileSync(CSV_PATH, lines.join("\n") + "\n");
}

function updateCsvStatus(csvRows, relPath, status, notes = "") {
  const row = csvRows.find(r => r.file_path === relPath);
  if (row) {
    row.status = status;
    if (notes) row.notes = notes;
  }
}

// ─── Directory Walker ────────────────────────────────────────

function walkDir(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.includes(":Zone.Identifier")) continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      results.push({ path: full, isDir: true });
      results.push(...walkDir(full));
    } else {
      results.push({ path: full, isDir: false });
    }
  }
  return results;
}

// ─── Main Import ─────────────────────────────────────────────

async function main() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);

  const user = await User.findOne({ email: TARGET_USER_EMAIL });
  if (!user) throw new Error(`User ${TARGET_USER_EMAIL} not found`);
  const userId = user.id;

  // Find existing grid + manifest
  const grid = await Grid.findOne({ userId }).lean();
  if (!grid) throw new Error("No grid found for user");
  const gridId = grid.id || grid._id.toString();

  const manifest = await Manifest.findOne({ userId, manifestType: "user" }).lean();
  if (!manifest) throw new Error("No user manifest found");

  const rootFolder = await Folder.findOne({ id: manifest.rootFolderId }).lean();
  if (!rootFolder) throw new Error("No root folder found");

  console.log(`User: ${userId}, Grid: ${gridId}, Manifest root: ${rootFolder.id}`);

  // Read CSV
  const { header, rows: csvRows } = readCsv();

  // Track created folders: dirPath → folderId
  const folderMap = new Map();

  // Create top-level import folders under manifest root (idempotent)
  const existingFolders = await Folder.find({ parentId: rootFolder.id }).lean();
  const maxSort = existingFolders.reduce((max, f) => Math.max(max, f.sortOrder || 0), 0);

  let codexRoot = existingFolders.find(f => f.name === "Codex");
  if (!codexRoot) {
    const id = uid();
    codexRoot = await Folder.create({ id, userId, parentId: rootFolder.id, name: "Codex", folderType: "normal", sortOrder: maxSort + 1, isExpanded: false, meta: { source: "codex-import" } });
  }
  let annotatedRoot = existingFolders.find(f => f.name === "Notes (Annotated)");
  if (!annotatedRoot) {
    const id = uid();
    annotatedRoot = await Folder.create({ id, userId, parentId: rootFolder.id, name: "Notes (Annotated)", folderType: "normal", sortOrder: maxSort + 2, isExpanded: false, meta: { source: "codex-import" } });
  }

  const codexRootFolderId = codexRoot.id;
  const annotatedRootFolderId = annotatedRoot.id;
  folderMap.set("codex", codexRootFolderId);
  folderMap.set("notes_codex_annotated", annotatedRootFolderId);

  console.log("Import folders ready.");

  // ─── Phase 1: Create all subdirectory folders ──────────────

  const sourceDirs = [
    { base: resolve(PROJECT_ROOT, "codex"), rootFolderId: codexRootFolderId, prefix: "codex" },
    { base: resolve(PROJECT_ROOT, "notes_codex_annotated"), rootFolderId: annotatedRootFolderId, prefix: "notes_codex_annotated" },
  ];

  for (const { base, rootFolderId, prefix } of sourceDirs) {
    const entries = walkDir(base);
    const dirs = entries.filter(e => e.isDir);

    // Sort by depth so parents are created before children
    dirs.sort((a, b) => a.path.split("/").length - b.path.split("/").length);

    // Pre-load existing folders for this tree to avoid duplicates
    const allExisting = await Folder.find({ userId }).lean();
    const existingByParentAndName = new Map();
    for (const f of allExisting) {
      existingByParentAndName.set(`${f.parentId}::${f.name}`, f);
    }

    for (let i = 0; i < dirs.length; i++) {
      const dirPath = dirs[i].path;
      const relDir = relative(resolve(PROJECT_ROOT), dirPath);
      const dirName = basename(dirPath);
      const parentRelDir = relative(resolve(PROJECT_ROOT), resolve(dirPath, ".."));

      const parentFolderId = folderMap.get(parentRelDir) || rootFolderId;
      const key = `${parentFolderId}::${dirName}`;
      const existing = existingByParentAndName.get(key);

      if (existing) {
        folderMap.set(relDir, existing.id);
      } else {
        const folderId = uid();
        folderMap.set(relDir, folderId);
        const created = await Folder.create({
          id: folderId, userId, parentId: parentFolderId,
          name: dirName, folderType: "normal", sortOrder: i, isExpanded: false, meta: { source: "codex-import" },
        });
        existingByParentAndName.set(key, created);
      }
    }
  }

  console.log(`Created ${folderMap.size} folders.`);

  // ─── Phase 1.5: Create folder-page modules for navigation ─

  const existingFolderPageMods = await Module.find({ userId, role: "page", kind: "folder", "meta.source": "codex-import" }).lean();
  const existingFolderPageOccs = await Occurrence.find({ userId, "meta.source": "codex-import" }).lean();
  const foldersWithPages = new Set();
  for (const occ of existingFolderPageOccs) {
    if (existingFolderPageMods.some(m => m.id === occ.targetId)) foldersWithPages.add(occ.parentId);
  }

  const folderPageModules = [];
  const folderPageOccs = [];
  for (const [, folderId] of folderMap) {
    if (foldersWithPages.has(folderId)) continue;
    const folder = await Folder.findOne({ id: folderId }).lean();
    if (!folder) continue;
    const modId = uid();
    folderPageModules.push({ id: modId, userId, gridId, role: "page", kind: "folder", label: folder.name, meta: { source: "codex-import" } });
    folderPageOccs.push({ id: uid(), userId, gridId, targetId: modId, targetType: "module", parentId: folderId, sortOrder: -1, iteration: { mode: "persistent" }, fields: {}, meta: { source: "codex-import" } });
  }
  if (folderPageModules.length) {
    await Module.insertMany(folderPageModules, { ordered: false });
    await Occurrence.insertMany(folderPageOccs, { ordered: false });
  }
  console.log(`Created ${folderPageModules.length} folder-page modules.`);

  // ─── Phase 2: Import files ────────────────────────────────

  let imported = 0;
  let errors = 0;

  // Batch arrays for bulk insert
  const moduleBatch = [];
  const occurrenceBatch = [];
  const viewBatch = [];
  const BATCH_SIZE = 200;

  const IMPORT_META = { source: "codex-import" };

  async function flushBatch() {
    if (moduleBatch.length) {
      for (const m of moduleBatch) m.meta = { ...m.meta, ...IMPORT_META };
      await Module.insertMany(moduleBatch, { ordered: false }).catch(e => console.error("Module batch error:", e.message));
      moduleBatch.length = 0;
    }
    if (viewBatch.length) {
      for (const v of viewBatch) v.meta = { ...v.meta, ...IMPORT_META };
      await View.insertMany(viewBatch, { ordered: false }).catch(e => console.error("View batch error:", e.message));
      viewBatch.length = 0;
    }
    if (occurrenceBatch.length) {
      for (const o of occurrenceBatch) o.meta = { ...o.meta, ...IMPORT_META };
      await Occurrence.insertMany(occurrenceBatch, { ordered: false }).catch(e => console.error("Occurrence batch error:", e.message));
      occurrenceBatch.length = 0;
    }
  }

  for (const { base, prefix } of sourceDirs) {
    const entries = walkDir(base).filter(e => !e.isDir);
    const isAnnotated = prefix === "notes_codex_annotated";

    for (let fi = 0; fi < entries.length; fi++) {
      const filePath = entries[fi].path;
      const relPath = relative(PROJECT_ROOT, filePath);
      const dirRelPath = relative(PROJECT_ROOT, resolve(filePath, ".."));
      const parentFolderId = folderMap.get(dirRelPath) || folderMap.get(prefix);
      const fileName = basename(filePath, extname(filePath));
      const ext = extname(filePath).toLowerCase();

      // Skip already-done files
      const csvRow = csvRows.find(r => r.file_path === relPath);
      if (csvRow && csvRow.status === "done") continue;

      // Only process text files
      if (![".md", ".txt"].includes(ext)) {
        updateCsvStatus(csvRows, relPath, "skipped", "non-text file");
        continue;
      }

      let content;
      try {
        content = fs.readFileSync(filePath, "utf-8");
      } catch (e) {
        updateCsvStatus(csvRows, relPath, "error", e.message);
        errors++;
        continue;
      }

      if (!content.trim()) {
        updateCsvStatus(csvRows, relPath, "skipped", "empty file");
        continue;
      }

      try {
        // Create page module
        const pageModId = uid();
        const pageOccId = uid();
        const viewId = uid();

        // Parse sections
        const sections = isAnnotated
          ? parseAnnotatedSections(content)
          : parseCodexSections(content);

        // Build the page-level textmap with embedded containers
        const pageContent = [];
        const childOccIds = [];

        // Page title heading
        pageContent.push({
          type: "heading", attrs: { level: 1 },
          content: [{ type: "text", text: fileName }],
        });

        for (let si = 0; si < sections.length; si++) {
          const section = sections[si];

          // Create container module + occurrence for this section
          const containerModId = uid();
          const containerOccId = uid();
          const containerViewId = uid();

          const sectionLabel = section.heading || `Section ${si + 1}`;

          // Build container textmap
          let containerContent = [];

          if (isAnnotated && section.annotationText) {
            // Annotated: content textblock + annotation textblock
            const contentTextblockModId = uid();
            const contentTextblockOccId = uid();
            const annotationTextblockModId = uid();
            const annotationTextblockOccId = uid();

            // Content textblock
            const contentTextmap = makeDocContent(section.contentLines);
            moduleBatch.push({
              id: contentTextblockModId, userId, gridId,
              role: "instance", kind: "doc", label: "",
            });
            occurrenceBatch.push({
              id: contentTextblockOccId, userId, gridId,
              targetId: contentTextblockModId, targetType: "module",
              parentId: containerOccId, sortOrder: 0,
              textmap: contentTextmap,
            });

            // Annotation textblock
            const annotationTextmap = {
              type: "doc",
              content: [{
                type: "blockquote",
                content: [{
                  type: "paragraph",
                  content: [
                    { type: "text", text: "[annotation] ", marks: [{ type: "bold" }] },
                    { type: "text", text: section.annotationText },
                  ],
                }],
              }],
            };
            moduleBatch.push({
              id: annotationTextblockModId, userId, gridId,
              role: "instance", kind: "doc", label: "annotation",
            });
            occurrenceBatch.push({
              id: annotationTextblockOccId, userId, gridId,
              targetId: annotationTextblockModId, targetType: "module",
              parentId: containerOccId, sortOrder: 1,
              textmap: annotationTextmap,
            });

            // Container textmap: embed the two textblocks
            containerContent = [
              {
                type: "paragraph",
                content: [{
                  type: "instancePill",
                  attrs: {
                    instanceId: contentTextblockModId,
                    instanceLabel: "",
                    occurrenceId: contentTextblockOccId,
                    pillDisplay: "block",
                    showIcon: false, showHeader: false,
                  },
                }],
              },
              {
                type: "paragraph",
                content: [{
                  type: "instancePill",
                  attrs: {
                    instanceId: annotationTextblockModId,
                    instanceLabel: "annotation",
                    occurrenceId: annotationTextblockOccId,
                    pillDisplay: "block",
                    showIcon: false, showHeader: false,
                  },
                }],
              },
            ];
          } else {
            // Non-annotated or no annotation: single textblock
            const textblockModId = uid();
            const textblockOccId = uid();
            const textmap = makeDocContent(section.contentLines);

            moduleBatch.push({
              id: textblockModId, userId, gridId,
              role: "instance", kind: "doc", label: "",
            });
            occurrenceBatch.push({
              id: textblockOccId, userId, gridId,
              targetId: textblockModId, targetType: "module",
              parentId: containerOccId, sortOrder: 0,
              textmap,
            });

            containerContent = [{
              type: "paragraph",
              content: [{
                type: "instancePill",
                attrs: {
                  instanceId: textblockModId,
                  instanceLabel: "",
                  occurrenceId: textblockOccId,
                  pillDisplay: "block",
                  showIcon: false, showHeader: false,
                },
              }],
            }];
          }

          // Container module
          moduleBatch.push({
            id: containerModId, userId, gridId,
            role: "container", kind: "doc", label: sectionLabel,
          });

          // Container view (doc type)
          viewBatch.push({
            id: containerViewId, userId, gridId, viewType: "doc",
          });

          // Container occurrence
          occurrenceBatch.push({
            id: containerOccId, userId, gridId,
            targetId: containerModId, targetType: "module",
            parentId: pageOccId, sortOrder: si,
            viewId: containerViewId,
            textmap: { type: "doc", content: containerContent },
          });

          childOccIds.push(containerOccId);

          // Add moduleEmbed to page textmap
          pageContent.push({
            type: "paragraph",
            content: [{ type: "moduleEmbed", attrs: { occurrenceId: containerOccId } }],
          });
        }

        // If no sections were parsed, just put raw content as single container
        if (!sections.length) {
          const rawTextmap = makeDocContent(content.split("\n"));
          const soloContModId = uid();
          const soloContOccId = uid();
          const soloContViewId = uid();

          moduleBatch.push({ id: soloContModId, userId, gridId, role: "container", kind: "doc", label: fileName });
          viewBatch.push({ id: soloContViewId, userId, gridId, viewType: "doc" });
          occurrenceBatch.push({
            id: soloContOccId, userId, gridId,
            targetId: soloContModId, targetType: "module",
            parentId: pageOccId, sortOrder: 0,
            viewId: soloContViewId,
            textmap: rawTextmap,
          });
          childOccIds.push(soloContOccId);
          pageContent.push({
            type: "paragraph",
            content: [{ type: "moduleEmbed", attrs: { occurrenceId: soloContOccId } }],
          });
        }

        // Page module
        moduleBatch.push({
          id: pageModId, userId, gridId,
          role: "page", kind: "doc", label: fileName,
        });

        // Page view
        viewBatch.push({
          id: viewId, userId, gridId, viewType: "doc",
        });

        // Page occurrence
        occurrenceBatch.push({
          id: pageOccId, userId, gridId,
          targetId: pageModId, targetType: "module",
          parentId: parentFolderId, sortOrder: fi,
          viewId,
          occurrences: childOccIds,
          textmap: { type: "doc", content: pageContent },
          iteration: { mode: "persistent" },
        });

        updateCsvStatus(csvRows, relPath, "done");
        imported++;

        if (moduleBatch.length >= BATCH_SIZE) {
          await flushBatch();
          process.stdout.write(`\rImported ${imported} files...`);
        }
      } catch (e) {
        updateCsvStatus(csvRows, relPath, "error", e.message.slice(0, 100));
        errors++;
      }
    }
  }

  // Final flush
  await flushBatch();

  // Write updated CSV
  writeCsv(header, csvRows);

  console.log(`\nDone! Imported: ${imported}, Errors: ${errors}, Skipped: ${csvRows.filter(r => r.status === "skipped").length}`);
  console.log(`CSV updated at: ${CSV_PATH}`);

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
