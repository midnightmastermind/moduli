// utils/occWriteQueue.js — the one queue of update_occurrence writes, so a delete can wait for them (see crud.js).
import { createSerialByKey } from "./serialByKey.js";

export const occWriteQueue = createSerialByKey();
export const occWriteKey = (userId, id) => `${userId}:${id}`;
/** Every occurrence write of this user that is running now has finished. */
export const occurrenceWritesSettled = (userId) => occWriteQueue.settled(`${userId}:`);
