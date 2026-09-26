// A snapshot must not carry ObjectIds as raw bytes (user, 2026-09-26: deleting a
// person made the browser drop its socket with "parse error" and reload).
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { Encoder } from "socket.io-parser";
import { snapshotDoc } from "../utils/txRecorder.js";

describe("snapshotDoc and ObjectIds", () => {
  const oid = new mongoose.Types.ObjectId();
  const mod = { id: "m", _id: new mongoose.Types.ObjectId(), label: "x", fieldBindings: [{ fieldId: "f", _id: oid }], createdAt: new Date(0) };

  it("turns a nested ObjectId into its hex string", () => {
    const snap = snapshotDoc(mod);
    expect(snap.fieldBindings[0]._id).toBe(oid.toHexString());
    expect(snap._id).toBeUndefined();
    expect(snap.createdAt).toBeInstanceOf(Date);
  });

  it("a broadcast of it is ONE text packet, never a binary message", () => {
    const packets = new Encoder().encode({ type: 2, nsp: "/", data: ["transaction_created", { transaction: { docs: [{ before: snapshotDoc(mod) }] } }] });
    expect(packets).toHaveLength(1);
    expect(typeof packets[0]).toBe("string");
  });

  it("does not share structure with the source", () => {
    const snap = snapshotDoc(mod);
    snap.fieldBindings[0].fieldId = "changed";
    expect(mod.fieldBindings[0].fieldId).toBe("f");
  });
});
