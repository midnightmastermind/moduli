// server/models/ImportCorrection.js
//
// A hand fix to an imported page (smarter imports Task 8): the text a textblock held when it arrived, and
// what the user changed it to. Fed back to Ollama's clean-up as examples, and a source for new eval cases.
import mongoose from "mongoose";

const ImportCorrectionSchema = new mongoose.Schema({
  userId:           { type: String, required: true },
  gridId:           { type: String, required: true },
  rootOccurrenceId: { type: String, required: true },
  occurrenceId:     { type: String, required: true },   // the textblock edited
  kind:             { type: String, default: null },    // link | image | text | html
  site:             { type: String, default: null },    // the source's host, for a link
  sourceUrl:        { type: String, default: null },
  before:           { type: String, default: "" },
  after:            { type: String, default: "" },
  createdAt:        { type: Date, default: Date.now },
  updatedAt:        { type: Date, default: Date.now },
});

ImportCorrectionSchema.index({ userId: 1, gridId: 1, kind: 1, site: 1, createdAt: -1 });
ImportCorrectionSchema.index({ userId: 1, occurrenceId: 1, createdAt: -1 });

export default mongoose.models.ImportCorrection || mongoose.model("ImportCorrection", ImportCorrectionSchema);
