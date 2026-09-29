// server/models/ShareStage.js
//
// A clip, parked for the ten minutes between clipping it and placing it.
// It holds NO grid data and writes none: staging is what lets the placement
// window exist without a half-made row appearing the moment you open it.
import mongoose from "mongoose";

const ShareStageSchema = new mongoose.Schema({
  id:        { type: String, required: true, unique: true, index: true },
  userId:    { type: String, required: true, index: true },
  // The authorization. 32 random bytes, hex. Compared in constant time.
  key:       { type: String, required: true },
  payload:   { type: mongoose.Schema.Types.Mixed, required: true },
  consumedAt:{ type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
});

// Mongo drops the row itself once it expires; `readStage` ALSO checks the date,
// because the TTL monitor runs about once a minute and "roughly expired" is not
// a property a credential should have.
ShareStageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.ShareStage || mongoose.model("ShareStage", ShareStageSchema);
