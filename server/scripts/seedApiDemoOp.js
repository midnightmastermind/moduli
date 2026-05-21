// scripts/seedApiDemoOp.js
//
// Mints a "Demo: Weather Lookup" operation in the user's first grid. The
// op demonstrates both halves of the API plan in one round-trip:
//
//   - Inbound REST: invoke it via
//     POST /api/v1/operations/<id>/run with body { "vars": { "$lat": ..., "$lon": ... } }
//   - Outbound CALL_API: the pipeline hits api.open-meteo.com to fetch
//     current temperature for the given coordinates, then surfaces the
//     result via SHOW_VALUE so it lands in the API response.
//
// Run: node --env-file=.env server/scripts/seedApiDemoOp.js <email>

import mongoose from "mongoose";
import crypto from "crypto";
import User from "../models/User.js";
import Grid from "../models/Grid.js";
import Operation from "../models/Operation.js";

const [, , email] = process.argv;
if (!email) {
  console.error("Usage: node server/scripts/seedApiDemoOp.js <email>");
  process.exit(1);
}

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/dnd_containers";
const uid = () => crypto.randomUUID();

const PIPELINE = {
  sources: [],
  steps: [
    // 1. Outbound: hit the open-meteo current-weather endpoint with the
    //    caller-supplied lat/lon. Response lands in $weather.
    {
      id: uid(),
      type: "action",
      config: {
        type: "CALL_API",
        url: "https://api.open-meteo.com/v1/forecast",
        method: "GET",
        query: {
          latitude: "$lat",
          longitude: "$lon",
          current: "temperature_2m,wind_speed_10m",
        },
        responseVar: "$weather",
        timeoutMs: 10000,
      },
    },
    // 2. Pull the temperature out of the response into its own var.
    {
      id: uid(),
      type: "action",
      config: { type: "INIT_VAR", name: "$temperature", expr: "$weather.current.temperature_2m" },
    },
    {
      id: uid(),
      type: "action",
      config: { type: "INIT_VAR", name: "$windSpeed", expr: "$weather.current.wind_speed_10m" },
    },
    {
      id: uid(),
      type: "action",
      config: { type: "INIT_VAR", name: "$units", expr: "$weather.current_units.temperature_2m" },
    },
    // 3. Surface results back to the API caller via SHOW_VALUE — these
    //    land under `vars` in the JSON response.
    {
      id: uid(),
      type: "action",
      config: { type: "SHOW_VALUE", name: "$temperature", value: "$temperature" },
    },
    {
      id: uid(),
      type: "action",
      config: { type: "SHOW_VALUE", name: "$windSpeed", value: "$windSpeed" },
    },
    {
      id: uid(),
      type: "action",
      config: { type: "SHOW_VALUE", name: "$units", value: "$units" },
    },
  ],
};

try {
  await mongoose.connect(MONGO_URI);
  const user = await User.findOne({ email });
  if (!user) {
    console.error(`No user with email ${email}`);
    process.exit(1);
  }
  const grid = await Grid.findOne({ userId: user._id.toString() }).sort({ createdAt: 1 });
  if (!grid) {
    console.error(`No grids for ${email} — run resetData / createLiveData first.`);
    process.exit(1);
  }

  const userId = user._id.toString();
  const gridId = grid._id.toString();
  const name = "Demo: Weather Lookup";

  // Idempotent — replace any prior op with the same name.
  const existing = await Operation.findOne({ userId, gridId, name });
  if (existing) await Operation.deleteOne({ _id: existing._id });

  const op = await Operation.create({
    id: uid(),
    userId,
    gridId,
    name,
    description: "Demonstrates inbound REST + outbound CALL_API. Invoke via POST /api/v1/operations/<id>/run with body { vars: { $lat, $lon } }.",
    triggerType: "manual",
    triggerTypes: ["manual"],
    triggerObjects: [],
    enabled: true,
    priority: 5,
    pipeline: PIPELINE,
  });

  console.log("\n✅ Demo op seeded:\n");
  console.log("  Op id:   ", op.id);
  console.log("  Op name: ", op.name);
  console.log("  Grid:    ", grid.name, `(${gridId})`);
  console.log("  User:    ", email);
  console.log("\n  Invoke with:");
  console.log(`    curl -sS -X POST http://localhost:5000/api/v1/operations/${op.id}/run \\`);
  console.log("      -H 'Authorization: Bearer <YOUR_TOKEN>' \\");
  console.log("      -H 'Content-Type: application/json' \\");
  console.log(`      -d '{"vars":{"$lat":41.88,"$lon":-87.63}}'   # Chicago\n`);

  await mongoose.disconnect();
} catch (err) {
  console.error("Error:", err);
  await mongoose.disconnect();
  process.exit(1);
}
