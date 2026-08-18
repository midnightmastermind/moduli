// socketHandlers/auth.js — register + login
//
// A FRESH ACCOUNT GETS AN EMPTY GRID. User, 2026-08-18: "a fresh accounts grid
// should be empty". Registering used to await `createDefaultUserData`, which
// writes ~1240 occurrences and ~1250 modules one at a time — measured at 50.7s
// against Atlas on 2026-08-18, all of it before auth_success reached the
// browser, so a new visitor sat on the login form for the better part of a
// minute. That file also declares itself FROZEN 2026-04-27 with operations in
// the legacy action vocabulary, so the workspace it built arrived carrying ops
// that cannot fire.
//
// Nothing replaces it, because nothing has to: `request_full_state` already
// mints a 1x1 grid for a user who has none (state.js, per the 2026-07-03
// decision that "fresh/empty grids start as a single empty cell"), and both
// manifests are ensured on that same path — so the tree, folder pages and the
// empty-cell add-panel flow all work on it. `createDefaultUserData` is NOT
// dead: `scripts/resetData.js` still uses it.
import User from "../models/User.js";

export function registerAuthHandlers(socket, { signToken }) {
  socket.on("register", async ({ email, password }) => {
    console.log("🟦 EVENT register:", { email });
    let exists = await User.findOne({ email });
    if (exists) return socket.emit("auth_error", "Email already exists");

    const user = await User.create({ email, password });
    const userId = user._id.toString();
    const token = signToken({ userId: user._id });

    // Nothing is seeded — see the note at the top of this file. The reply goes
    // out immediately, and the empty grid is minted by the first full_state.
    console.log("✅ Register success:", userId);
    socket.emit("auth_success", { token, userId });
  });

  socket.on("login", async ({ email, password } = {}) => {
    console.log("🟦 EVENT login:", { email });
    try {
      const user = await User.findOne({ email });
      if (!user) return socket.emit("auth_error", "Invalid email or password");

      const match = await user.comparePassword(password);
      if (!match) return socket.emit("auth_error", "Invalid email or password");

      const token = signToken({ userId: user._id });
      console.log("✅ Login success:", user._id.toString());
      socket.emit("auth_success", { token, userId: user._id.toString() });
    } catch (err) {
      console.error("❌ Login error:", err.stack || err.message);
      socket.emit("auth_error", "Server error during login");
    }
  });
}
