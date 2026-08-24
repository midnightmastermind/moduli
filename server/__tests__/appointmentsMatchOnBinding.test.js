// 0220 — driven through the migration's OWN exported rewriter.
import { describe, it, expect } from "vitest";
import { retargetToBinding } from "../migrations/0220-appointments-match-on-binding.mjs";

const pipe = () => ({ steps: [{
  type: "if",
  condition: { operator: "AND", rules: [
    { left: "$appt.templateId", comparator: "IS", right: "appt-mod" },
    { left: "$appt.fields.d.value", comparator: "SAME_DAY", right: "$day" },
  ]},
  then: [{ type: "loop", body: [{
    type: "if",
    condition: { operator: "AND", rules: [
      { operator: "OR", rules: [{ left: "$placed.templateId", comparator: "IS", right: "appt-mod" }] },
    ]},
  }]}],
}]});

describe("0220 — appointments match on the module binding", () => {
  it("rewrites BOTH arms, including one nested inside an OR group", () => {
    const { pipeline, touched } = retargetToBinding(pipe(), "f-marker");
    expect(touched.sort()).toEqual(["$appt", "$placed"]);
    const j = JSON.stringify(pipeline);
    expect(j).toContain('"$appt._boundFieldIds"');
    expect(j).toContain('"$placed._boundFieldIds"');
    expect(j).toContain('"ARRAY_INCLUDES"');
    expect(j).toContain('"f-marker"');
    // The old rule is GONE, not merely accompanied.
    expect(j).not.toContain('"$appt.templateId"');
    expect(j).not.toContain('"$placed.templateId"');
  });

  it("leaves OTHER templateId rules alone — they belong to other pipelines", () => {
    // `$todoTemplateId` and the cycle ops match on templateId too; an
    // untargeted rewrite would reach into pipelines this has no business in.
    const other = { steps: [{ condition: { operator: "AND", rules: [
      { left: "templateId", comparator: "IS", right: "$todoTemplateId" },
      { left: "$src.templateId", comparator: "IS", right: "x" },
    ]}}]};
    const { pipeline, touched } = retargetToBinding(other, "f-marker");
    expect(touched).toEqual([]);
    expect(JSON.stringify(pipeline)).toContain('"$todoTemplateId"');
    expect(JSON.stringify(pipeline)).toContain('"$src.templateId"');
  });

  it("does not mutate the pipeline it was handed", () => {
    // The runner reads the stored op; mutating it in place would leave a
    // half-rewritten object behind if a later guard threw.
    const original = pipe();
    const before = JSON.stringify(original);
    retargetToBinding(original, "f-marker");
    expect(JSON.stringify(original)).toBe(before);
  });

  it("is a no-op on a second pass", () => {
    const once = retargetToBinding(pipe(), "f-marker").pipeline;
    expect(retargetToBinding(once, "f-marker").touched).toEqual([]);
  });
});
