// services/importShape.js
//
// Lives here rather than in socketHandlers/import.js because the REST
// `/api/v1/import/url` route (what Jonah calls) needs the SAME decision — a
// route importing a socket-handler module to reach it would be the wrong edge.
import { markdownToModuli, planReaderShape } from "./markdownImporter.js";

// WHICH TREE A PAGE BECOMES — the ONE place that decides, because two places
// deciding is how the tree you READ and the tree you IMPORT drift apart.
//
// `import_plan` renders Reader/Magic; `import_text` mints what the viewer's
// "add as a page" button asks for. They took different code paths until
// 2026-09-16 — the planner knew about `shape` and the minter did not, so the
// button would have handed back a magic tree no matter which view you were
// looking at.
//
// "reader" keeps the article as one container + one textblock; anything else
// (including absent) is MAGIC — the importer's full tree, which is what every
// caller got before the argument existed.
export async function buildImportShape({ shape, gridId, userId, markdown, title, parentId = null, dryRun }) {
  if (shape === "reader") {
    return planReaderShape({
      gridId: gridId || null, userId, markdown, title: title || null, parentId,
    });
  }
  return markdownToModuli({
    gridId: gridId || null, parentId, userId, markdown, dryRun, title,
    // MAGIC STRUCTURES THE PAGE (user, 2026-09-13): *"it needs to be smart like
    // the wikipedia import … textblocks inside doccontainers inside
    // doccontainers"*. Bold-only lines become sections too, since most pages use
    // those instead of headings.
    boldSections: true,
  });
}

