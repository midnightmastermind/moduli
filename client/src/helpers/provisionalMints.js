// helpers/provisionalMints.js
//
// EVERY PROVISIONAL BLOCK A DOC HAS MINTED — not just the last one.
//
// `DocContent` tracked its click-minted textblocks in TWO SINGLE SLOTS:
//
//     const provisionalOccIdRef = useRef(null);   // the LAST id
//     const mintWritesRef       = useRef(null);   // the LAST pending write
//
// while the registry they feed (`helpers/provisionalTextblock`) is a MAP. One
// click on an empty line is fine; the user clicks several (2026-09-17 video,
// three empty blocks on screen at once), and then:
//
//   1. The unmount cleanup discards only the LAST id, so every earlier block
//      LEAKS in the registry. That is not cosmetic — `Editor.persistContent`
//      returns early while `hasProvisionalTextblock(json)` is true, and a leaked
//      entry whose node is still in the document keeps it true FOREVER. The
//      parent doc silently stops saving, and every later edit is dropped.
//
//   2. Minting a second block CANCELLED the first's store writes
//      (`mintWritesRef.current?.cancel?.()`), so a block still on screen was
//      denied its server row. The `isProvisionalTextblock` guard inside the
//      deferred write already covers the case that cancel was written for — an
//      abandoned block — so cancelling a DIFFERENT block was never needed.
//
// Keeping the bookkeeping here means it is testable without mounting DocContent,
// which needs the whole grid store.

/**
 * A per-document ledger of blocks minted but not yet committed or discarded.
 */
export function createMintLedger() {
  const ids = new Set();
  const cancels = new Map();

  return {
    /** A block was just minted. `cancel` aborts its deferred store writes. */
    add(id, cancel) {
      if (!id) return;
      ids.add(id);
      if (typeof cancel === "function") cancels.set(id, cancel);
    },

    /**
     * This block is no longer provisional — committed, discarded, or its
     * writes have run. Dropping the cancel with it is what stops a later
     * unmount aborting writes that already landed.
     */
    settle(id) {
      if (!id) return;
      ids.delete(id);
      cancels.delete(id);
    },

    /**
     * The document is going away. Cancel every pending write and hand back
     * EVERY id still outstanding, so the caller can discard all of them.
     */
    drain() {
      for (const cancel of cancels.values()) {
        try { cancel(); } catch (_) { /* a cancel must never block the rest */ }
      }
      cancels.clear();
      const out = [...ids];
      ids.clear();
      return out;
    },

    /** Outstanding count — for tests and diagnostics. */
    size() {
      return ids.size;
    },
  };
}
