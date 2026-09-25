// __tests__/undoOnlyTopOfStack.test.js
//
// Undo writes back each document's WHOLE `before` snapshot, so undoing an older
// transaction out of order also erases every later edit to the same rows. The
// history panel's per-row Undo sent exactly such an id. As of 2026-09-25 only
// the newest undoable transaction can be undone: an explicit id must name it,
// and a derived (operation/background) write is never on the stack at all.
import { describe, it, expect, vi, beforeEach } from "vitest";

const txs = [];
const matches = (tx, q) => Object.entries(q).every(([k, v]) => {
  if (k === "docs") return Array.isArray(tx.docs) && tx.docs.length > 0;
  if (k === "meta.derived") return tx.meta?.derived !== true;
  if (k === "state" && v?.$in) return v.$in.includes(tx.state);
  return tx[k] === v;
});
vi.mock("../models/Transaction.js", () => ({
  default: {
    findOne: vi.fn((q) => {
      const rows = txs.filter(t => matches(t, q));
      const res = {
        sort: ({ sequence }) => Promise.resolve(
          [...rows].sort((a, b) => (sequence < 0 ? b.sequence - a.sequence : a.sequence - b.sequence))[0] || null,
        ),
        then: (ok, err) => Promise.resolve(rows[0] || null).then(ok, err),
      };
      return res;
    }),
    findOneAndUpdate: vi.fn(async ({ id }, { $set }) => { Object.assign(txs.find(t => t.id === id), $set); }),
  },
}));
vi.mock("../utils/txRecorder.js", () => ({ closeAction: vi.fn(), flushAll: vi.fn(async () => {}) }));

const { registerTransactionHandlers } = await import("../socketHandlers/transactions.js");

const written = [];
function setup() {
  const handlers = new Map();
  const emitted = [];
  const socket = {
    userId: "u1", data: { activeGridId: "g1" },
    on: (e, fn) => handlers.set(e, fn),
    emit: (e, d) => emitted.push({ e, d }),
  };
  const Model = {
    findOneAndUpdate: vi.fn(async (f, u) => written.push({ f, u })),
    findOneAndDelete: vi.fn(async () => null),
  };
  registerTransactionHandlers(socket, {
    io: { to: () => ({ emit: () => {} }) },
    ensureUserCache: () => ({ occurrencesById: {} }), userCacheReady: () => true,
    loadUserIntoCache: async () => {}, userRoom: (u) => `user:${u}`,
    getModelByType: () => Model,
  });
  return { undo: (p) => handlers.get("undo_transaction")(p), emitted };
}

const snap = (id, sequence, extra = {}) => ({
  id, userId: "u1", gridId: "g1", sequence, state: "applied", description: id,
  docs: [{ model: "occurrence", id: "row", before: { v: sequence - 1 }, after: { v: sequence } }],
  meta: {}, ...extra,
});

beforeEach(() => {
  txs.length = 0; written.length = 0;
  txs.push(snap("old", 1), snap("new", 2), snap("op", 3, { meta: { derived: true } }));
});

const result = (emitted) => emitted.find(x => x.e === "undo_result")?.d;

describe("undo_transaction only takes back the newest user change", () => {
  it("refuses an OLDER transaction by id and writes nothing", async () => {
    const { undo, emitted } = setup();
    await undo({ transactionId: "old", gridId: "g1" });
    expect(result(emitted)).toMatchObject({ success: false });
    expect(written).toHaveLength(0);
    expect(txs.find(t => t.id === "old").state).toBe("applied");
  });

  it("refuses a derived (operation) transaction by id", async () => {
    const { undo, emitted } = setup();
    await undo({ transactionId: "op", gridId: "g1" });
    expect(result(emitted)).toMatchObject({ success: false });
    expect(txs.find(t => t.id === "op").state).toBe("applied");
  });

  it("accepts the newest undoable transaction by id", async () => {
    const { undo, emitted } = setup();
    await undo({ transactionId: "new", gridId: "g1" });
    expect(result(emitted)).toMatchObject({ success: true, transactionId: "new" });
    expect(txs.find(t => t.id === "new").state).toBe("undone");
  });

  it("control: with no id it resolves the stack top (skipping the derived write)", async () => {
    const { undo, emitted } = setup();
    await undo({ gridId: "g1" });
    expect(result(emitted)).toMatchObject({ success: true, transactionId: "new" });
  });
});
