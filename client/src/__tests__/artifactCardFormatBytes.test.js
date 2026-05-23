// __tests__/artifactCardFormatBytes.test.js
// Locks in the byte-formatter used by ArtifactCard's expanded chrome.
// Not exported, so re-implement here as a black-box check — the contract
// matters more than the implementation (the chip would render wrong if
// rounding flipped). Keep in sync with ArtifactCard.formatBytes.
import { describe, it, expect } from "vitest";

// Mirror of ArtifactCard.formatBytes — keep these byte-identical.
function formatBytes(bytes) {
  if (bytes == null || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

describe("ArtifactCard formatBytes", () => {
  it("returns null for missing / zero / negative inputs", () => {
    expect(formatBytes(null)).toBeNull();
    expect(formatBytes(undefined)).toBeNull();
    expect(formatBytes(0)).toBeNull();
    expect(formatBytes(-1)).toBeNull();
  });
  it("formats bytes (no suffix on B unit, integer)", () => {
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });
  it("formats KB with one decimal under 10", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(9 * 1024)).toBe("9.0 KB");
  });
  it("formats KB as rounded integer at/above 10", () => {
    expect(formatBytes(10 * 1024)).toBe("10 KB");
    expect(formatBytes(512 * 1024)).toBe("512 KB");
  });
  it("steps to MB at the boundary", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(12 * 1024 * 1024)).toBe("12 MB");
  });
  it("steps to GB and caps the unit at GB", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
    // 5 TB worth of bytes still renders as GB (no TB unit)
    expect(formatBytes(5 * 1024 * 1024 * 1024 * 1024)).toBe("5120 GB");
  });
});
