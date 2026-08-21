// client/src/helpers/treeExpansion.js
//
// WHICH MANIFEST FOLDERS ARE OPEN. Per BROWSER, not per grid.
//
// User, 2026-08-20: *"could you make every folder closed by default in the
// manifest sidebar. all the folders currently are expanded to start."*
//
// WHY NOT `Folder.isExpanded`, which already exists and looks like exactly this.
// Because it is not what it looks like: `FolderNode` seeded its open state from
// it and **nothing has ever written it back**, so it is a seed-time initial
// value rather than a preference. Persisting there would mean a socket write to
// live grid data on every folder click, for something that is per-device by
// nature — and it would sync one machine's browsing state onto another. The
// field stays where it is (the Command Center category tabs still read it) and
// is now inert for the sidebar; the sidebar's own comment says so.
//
// EVERY PATH FAILS OPEN TO "CLOSED", which is the same state as a first visit.
// A sidebar that throws on mount takes the panel down with it, and there is
// nothing here worth risking that for: the worst case is you re-open a folder.

export const STORE_KEY = "moduli-tree-open";

function read() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    // Shape-checked, not just parse-checked: an older/other writer could leave
    // an object here, and `new Set({})` is silently empty rather than an error —
    // which would look like the memory quietly not working.
    return Array.isArray(parsed) ? new Set(parsed.filter((x) => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function write(set) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...set]));
  } catch {
    // Storage unavailable (private mode, quota). The sidebar still opens and
    // closes for this session; it just cannot remember.
  }
}

/** Is this folder open? Unknown folders — i.e. all of them, the first time — are CLOSED. */
export function isFolderOpen(folderId) {
  if (!folderId) return false;
  return read().has(folderId);
}

/** Remember that this folder is open (or forget it). */
export function setFolderOpen(folderId, open) {
  if (!folderId) return;
  const set = read();
  if (open) set.add(folderId);
  else set.delete(folderId);
  write(set);
}
