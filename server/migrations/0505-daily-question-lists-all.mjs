// 0505 — the Daily Question lists every question (user, 2026-11-16, after 0504 restored 117): its options stopped at
// the resolver's default of 100. The same setting as Command Center › Fields › Daily Question › limit.
export const id = "0505-daily-question-lists-all";
export const describe = "Daily Question's options list up to 500 (was the default 100; there are 117 questions).";
export const touches = ["fields"];
const DQ_FIELD = "Kq-dG1dQ2-89";
export async function up({ gridId, models, log, dryRun }) {
  const { Field } = models;
  const f = await Field.findOne({ gridId, id: DQ_FIELD }).lean();
  if (!f?.meta?.optionsSource?.find) throw new Error("REFUSING: Daily Question has no find options");
  log(`  limit: ${f.meta.optionsSource.find.limit ?? "default 100"} → 500`);
  if (dryRun) return;
  await Field.updateOne({ gridId, id: DQ_FIELD }, { $set: { "meta.optionsSource.find.limit": 500 } });
  const back = await Field.findOne({ gridId, id: DQ_FIELD }).lean();
  log(`  read back: ${back.meta.optionsSource.find.limit}`);
  if (back.meta.optionsSource.find.limit !== 500) throw new Error("read-back failed");
}
