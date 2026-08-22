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

/**
 * THE KEY IS SCOPED BY SECTION, and that is a bug fix rather than a tidy-up.
 *
 * The sidebar draws the SAME folder in two places: once inside `Pinned` (a
 * pinned folder page renders its real subtree) and again in the full `Root`
 * manifest below. Keyed by folder id alone, those two rows shared one open
 * state — so expanding `Interfaces` in Root silently expanded it inside Pinned
 * too, and as you browsed, Pinned filled up with a copy of the manifest. That
 * is the user's 2026-08-22 report, verbatim: *"the entire root folder is being
 * opened in the pinned"*.
 *
 * THE ROOT SCOPE KEEPS THE BARE ID on purpose. Prefixing both would be cleaner
 * to look at and would make every existing browser forget which folders it had
 * open — a silent reset of the one thing this file exists to remember. Only the
 * new, second place a folder can appear gets a prefix.
 */
export const ROOT_SCOPE = "root";

export function folderKey(folderId, scope = ROOT_SCOPE) {
  if (!folderId) return null;
  return scope === ROOT_SCOPE ? folderId : `${scope}:${folderId}`;
}

/** Is this folder open? Unknown folders — i.e. all of them, the first time — are CLOSED. */
export function isFolderOpen(folderId, scope = ROOT_SCOPE) {
  const key = folderKey(folderId, scope);
  if (!key) return false;
  return read().has(key);
}

/** Remember that this folder is open (or forget it). */
export function setFolderOpen(folderId, open, scope = ROOT_SCOPE) {
  const key = folderKey(folderId, scope);
  if (!key) return;
  const set = read();
  if (open) set.add(key);
  else set.delete(key);
  write(set);
}
