// Smoke + shape regression for the inline textblock TipTap extension (LT1).
import { describe, expect, it } from "vitest";
import { InstanceTextblockInline } from "../docs/InstanceTextblockInlineExtension";

describe("InstanceTextblockInline TipTap extension", () => {
  it("is named instanceTextblockInline and runs inline", () => {
    expect(InstanceTextblockInline.name).toBe("instanceTextblockInline");
    const cfg = InstanceTextblockInline.config;
    expect(cfg.group).toBe("inline");
    expect(cfg.inline).toBe(true);
    expect(cfg.atom).toBe(true);
  });

  it("declares instanceId + occurrenceId attrs", () => {
    const attrs = InstanceTextblockInline.config.addAttributes.call({
      name: "instanceTextblockInline",
    });
    expect(attrs).toHaveProperty("instanceId");
    expect(attrs).toHaveProperty("occurrenceId");
    expect(attrs.instanceId.default).toBeNull();
    expect(attrs.occurrenceId.default).toBeNull();
  });

  it("exposes insertInstanceTextblockInline command", () => {
    const commands = InstanceTextblockInline.config.addCommands.call({
      name: "instanceTextblockInline",
    });
    expect(commands).toHaveProperty("insertInstanceTextblockInline");
    expect(typeof commands.insertInstanceTextblockInline).toBe("function");
  });

  it("parseHTML targets a span tagged with data-instance-textblock-inline", () => {
    const rules = InstanceTextblockInline.config.parseHTML.call({
      name: "instanceTextblockInline",
    });
    expect(Array.isArray(rules)).toBe(true);
    expect(rules[0].tag).toBe('span[data-instance-textblock-inline="true"]');
  });
});
