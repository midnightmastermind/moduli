// socketHandlers/auth.js — register + login
import User from "../models/User.js";
import createDefaultUserData from "../utils/createDefaultUserData.js";

export function registerAuthHandlers(socket, { signToken }) {
  socket.on("register", async ({ email, password }) => {
    console.log("🟦 EVENT register:", { email });
    let exists = await User.findOne({ email });
    if (exists) return socket.emit("auth_error", "Email already exists");

    const user = await User.create({ email, password });
    const userId = user._id.toString();
    const token = signToken({ userId: user._id });

    try {
      console.log("📊 Creating default data for new user:", userId);
      const { gridId, summary } = await createDefaultUserData(userId);
      console.log("✅ Default data created - Grid:", gridId, "Summary:", summary);
    } catch (err) {
      console.error("⚠️ Failed to create default data:", err.message);
    }

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
