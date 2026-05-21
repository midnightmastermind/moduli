// __tests__/moduleIcons.test.js
// Smoke coverage for the shared module-icon helper.
import { describe, it, expect } from "vitest";
import {
  getModuleTypeIcon, getModuleTypeColor, getModuleTypeBadge,
  KIND_ICONS, ROLE_ICONS, FIELD_TYPE_ICONS,
} from "../helpers/moduleIcons";

describe("getModuleTypeIcon", () => {
  it("prefers field.type when a field is passed", () => {
    expect(getModuleTypeIcon(null, { type: "number" })).toBe(FIELD_TYPE_ICONS.number);
    expect(getModuleTypeIcon(null, { type: "boolean" })).toBe(FIELD_TYPE_ICONS.boolean);
  });

  it("prefers module.kind over module.role when both are set", () => {
    const Icon = getModuleTypeIcon({ kind: "board", role: "container" });
    expect(Icon).toBe(KIND_ICONS.board);
    expect(Icon).not.toBe(ROLE_ICONS.container);
  });

  it("falls back to module.role when kind is unrecognized", () => {
    expect(getModuleTypeIcon({ kind: "unknown-kind", role: "instance" })).toBe(ROLE_ICONS.instance);
  });

  it("falls back to module.role when kind is unset", () => {
    expect(getModuleTypeIcon({ role: "textblock" })).toBe(ROLE_ICONS.textblock);
  });

  it("returns the File catch-all for null / empty module", () => {
    const Icon = getModuleTypeIcon(null);
    expect(typeof Icon).toBe("object"); // forwardRef component
  });

  it("returns a HelpCircle-ish fallback for unknown field types", () => {
    const Icon = getModuleTypeIcon(null, { type: "nope" });
    expect(typeof Icon).toBe("object");
  });
});

describe("getModuleTypeColor", () => {
  it("returns the kind color when kind is recognized", () => {
    expect(getModuleTypeColor({ kind: "folder" })).toBe("#f59e0b");
    expect(getModuleTypeColor({ kind: "board" })).toContain("rgba");
  });

  it("falls back to role color when kind is unset", () => {
    expect(getModuleTypeColor({ role: "page" })).toBe("#06b6d4");
  });

  it("returns text-secondary CSS var for empty module", () => {
    expect(getModuleTypeColor(null)).toBe("var(--text-secondary)");
  });

  it("returns a light-blue field color for field refs", () => {
    expect(getModuleTypeColor(null, { type: "number" })).toContain("accent-blue-text");
  });
});

describe("getModuleTypeBadge", () => {
  it("returns the icon and color together", () => {
    const badge = getModuleTypeBadge({ kind: "canvas" });
    expect(badge.Icon).toBe(KIND_ICONS.canvas);
    expect(badge.color).toContain("rgba");
  });
});
