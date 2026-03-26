// utils/mdParsers.js
// Markdown section parsers used by createDefaultUserData.js

import fs from "fs";

// Parse a markdown file into sections. ONE instance per section.
// headingLevel: 1 = use # headings, 2 = use ## headings
// Returns [{ heading, lines }] where lines is ALL raw content lines in the section.
// Content before the first heading is captured as an "Introduction" section.
export function parseSections(filePath, headingLevel = 2, maxSections = 8) {
  let raw = "";
  try { raw = fs.readFileSync(filePath, "utf-8"); } catch { return []; }
  const prefix = "#".repeat(headingLevel) + " ";
  const deeperPrefix = "#".repeat(headingLevel + 1);
  const lines = raw.split("\n");
  const sections = [];
  let current = null;
  let preambleLines = [];
  for (const line of lines) {
    if (line.startsWith(prefix) && !line.startsWith(deeperPrefix)) {
      // Flush preamble as first section if it has non-empty content
      if (!current && preambleLines.some(l => l.trim())) {
        sections.push({ heading: "Introduction", lines: preambleLines });
      }
      if (current) sections.push(current);
      if (sections.length >= maxSections) { current = null; break; }
      current = { heading: line.slice(prefix.length).trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  if (current && sections.length < maxSections) sections.push(current);
  return sections;
}

// Two-level parser: sectionLevel headings → doc containers, instanceLevel headings within → doc instances.
// Each section: { heading, instances: [{heading, lines}], extraLines }
// extraLines = lines not under any instance heading (rendered as inline markdown in container body)
// Content before the first section heading is captured as an "Introduction" section.
export function parseSectionsWithInstances(filePath, sectionLevel = 2, instanceLevel = 3, maxSections = 8) {
  let raw = "";
  try { raw = fs.readFileSync(filePath, "utf-8"); } catch { return []; }
  const secPrefix  = "#".repeat(sectionLevel)  + " ";
  const instPrefix = "#".repeat(instanceLevel) + " ";
  const deeperInstPrefix = "#".repeat(instanceLevel + 1);
  const lines = raw.split("\n");
  const sections = [];
  let curSection = null;
  let curInstance = null;
  let preambleLines = [];

  const pushInstance = () => {
    if (curInstance && curSection) curSection.instances.push(curInstance);
    curInstance = null;
  };

  for (const line of lines) {
    // Section-level heading
    if (line.startsWith(secPrefix) && !line.startsWith(instPrefix)) {
      pushInstance();
      // Flush preamble as first section if it has non-empty content
      if (!curSection && preambleLines.some(l => l.trim())) {
        sections.push({ heading: "Introduction", instances: [], extraLines: preambleLines });
      }
      if (curSection) sections.push(curSection);
      if (sections.length >= maxSections) { curSection = null; break; }
      curSection = { heading: line.slice(secPrefix.length).trim(), instances: [], extraLines: [] };
    // Instance-level heading within a section
    } else if (curSection && line.startsWith(instPrefix) && !line.startsWith(deeperInstPrefix)) {
      pushInstance();
      curInstance = { heading: line.slice(instPrefix.length).trim(), lines: [] };
    } else if (curInstance) {
      curInstance.lines.push(line);
    } else if (curSection) {
      curSection.extraLines.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  pushInstance();
  if (curSection && sections.length < maxSections) sections.push(curSection);
  return sections;
}
