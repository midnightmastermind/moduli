// scripts/testRaceFix.js
// Verifies that the create_occurrence atomic-$push fix prevents lost children
// when many concurrent create_occurrence events target the same parent.

import "dotenv/config";
import mongoose from "mongoose";
import Occurrence from "../models/Occurrence.js";
import { setupOccurrencesCRUD } from "../socketHandlers/crud.js";

const TEST_USER = "race_fix_user";
const TEST_GRID = "race_fix_grid";
const PARENT_ID = "race_parent";

function mockSocket() {
  const handlers = {};
  return {
    on: (event, fn) => { handlers[event] = fn; },
    emit: () => {},
    to: () => ({ emit: () => {} }),
    fire: (event, payload) => handlers[event](payload),
    handlers,
  };
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  await Occurrence.deleteMany({ userId: TEST_USER });
  await Occurrence.create({
    id: PARENT_ID,
    userId: TEST_USER,
    gridId: TEST_GRID,
    targetType: "module",
    targetId: "race_parent_mod",
    occurrences: [],
  });

  const uc = { occurrencesById: { [PARENT_ID]: { id: PARENT_ID, occurrences: [] } } };
  const socket = mockSocket();
  setupOccurrencesCRUD(socket, TEST_USER, async () => uc, {});

  // Fire 49 concurrent create_occurrence events all targeting the same parent.
  const N = 49;
  const childIds = Array.from({ length: N }, (_, i) => `race_child_${String(i).padStart(2, "0")}`);
  const events = childIds.map((id, i) =>
    socket.fire("create_occurrence", {
      occurrence: {
        id, userId: TEST_USER, gridId: TEST_GRID,
        targetType: "module", targetId: `race_child_mod_${i}`,
        parentId: PARENT_ID,
        // First child gets insertAtIndex:0 (mimics the Due insertion); rest append
        ...(i === 0 ? { insertAtIndex: 0 } : {}),
      },
    })
  );
  await Promise.all(events);

  const parent = await Occurrence.findOne({ id: PARENT_ID, userId: TEST_USER }).lean();
  const got = parent?.occurrences || [];
  const missing = childIds.filter(id => !got.includes(id));
  console.log(`Expected ${N} children in parent.occurrences; got ${got.length}; missing ${missing.length}`);
  if (missing.length) console.log("missing IDs:", missing);
  // Expected order: child[0] is at index 0 (insertAtIndex:0), then child[1..N-1] appended in emit order
  const expectedOrder = [childIds[0], ...childIds.slice(1)];
  const orderMatches = JSON.stringify(got) === JSON.stringify(expectedOrder);
  console.log("order preserved (matches emit order):", orderMatches);
  if (!orderMatches) console.log("got order:", got.slice(0, 5), "... (first 5)");
  console.log(missing.length === 0 && orderMatches ? "PASS — atomic $push retained every concurrent append in emit order" : "FAIL");

  await Occurrence.deleteMany({ userId: TEST_USER });
  await mongoose.disconnect();
  process.exit(missing.length === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
