// __tests__/registerEmptyGrid.test.js
//
// USER, 2026-08-18: "a fresh accounts grid should be empty".
//
// Registration used to await `createDefaultUserData` before replying — ~1240
// occurrences and ~1250 modules written one at a time, measured at 50.7s
// against Atlas, all of it in front of the visitor. This drives the REAL
// handler with User and the seeder mocked, and asserts the two things that
// matter: the reply goes out, and NOTHING is seeded.
//
// The "does not seed" assertion only means something because the mock proves
// it CAN be observed — the seeder spy is asserted callable in its own test
// first. An assertion of absence proves nothing until you have proven the
// thing can be present (2026-08-01 (16)).
import { describe, it, expect, vi, beforeEach } from "vitest";

const seedSpy = vi.fn(async () => ({ gridId: "g1", summary: {} }));
vi.mock("../utils/createDefaultUserData.js", () => ({
  default: seedSpy,
  createDefaultUserData: seedSpy,
}));

const created = [];
vi.mock("../models/User.js", () => ({
  default: {
    findOne: vi.fn(async () => null),
    create: vi.fn(async (doc) => {
      const u = { ...doc, _id: { toString: () => "user-1" } };
      created.push(u);
      return u;
    }),
  },
}));

const { registerAuthHandlers } = await import("../socketHandlers/auth.js");
const User = (await import("../models/User.js")).default;

function fakeSocket() {
  const handlers = {};
  const emitted = [];
  return {
    on: (ev, fn) => { handlers[ev] = fn; },
    emit: (ev, payload) => emitted.push([ev, payload]),
    fire: (ev, payload) => handlers[ev](payload),
    emitted,
  };
}

beforeEach(() => {
  seedSpy.mockClear();
  created.length = 0;
  User.findOne.mockResolvedValue(null);
});

describe("register", () => {
  it("replies with a token and a userId", async () => {
    const s = fakeSocket();
    registerAuthHandlers(s, { signToken: () => "tok-1" });
    await s.fire("register", { email: "a@b.c", password: "pw" });
    expect(s.emitted).toContainEqual(["auth_success", { token: "tok-1", userId: "user-1" }]);
  });

  // THE ASK. A fresh account gets an empty grid — the 1x1 that
  // request_full_state mints for a user with none — not a seeded workspace.
  it("seeds nothing", async () => {
    const s = fakeSocket();
    registerAuthHandlers(s, { signToken: () => "tok-1" });
    await s.fire("register", { email: "a@b.c", password: "pw" });
    expect(seedSpy).not.toHaveBeenCalled();
  });

  // The control: without this, "not called" could just mean the spy is inert.
  it("the seeder spy is observable, so 'not called' means something", async () => {
    const mod = await import("../utils/createDefaultUserData.js");
    await mod.default("whoever");
    expect(seedSpy).toHaveBeenCalledWith("whoever");
  });

  it("refuses an email that already exists, and creates no user", async () => {
    User.findOne.mockResolvedValue({ _id: "existing" });
    const s = fakeSocket();
    registerAuthHandlers(s, { signToken: () => "tok-1" });
    await s.fire("register", { email: "a@b.c", password: "pw" });
    expect(s.emitted).toEqual([["auth_error", "Email already exists"]]);
    expect(created).toEqual([]);
  });
});
