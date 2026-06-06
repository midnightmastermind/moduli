import { describe, it, expect, vi } from "vitest";
import { links } from "../services/wikipediaTools.js";

describe("wikipediaTools.links — outbound article titles", () => {
  it("extracts real article titles; filters namespaces, self-links, dups; caps at max", async () => {
    const html = `
      <a href="./Dr._Dre">Dr. Dre</a>
      <a href="/wiki/50_Cent">50 Cent</a>
      <a href="./File:Pic.jpg">a file</a>
      <a href="./Help:Contents">help</a>
      <a href="./Category:Rappers">cat</a>
      <a href="./Dr._Dre">dup of dre</a>
      <a href="./Eminem">self link</a>
      <a href="./D12_(band)#History">D12 with anchor</a>
    `;
    const realFetch = global.fetch;
    global.fetch = vi.fn(async () => ({ ok: true, text: async () => html }));
    try {
      const r = await links("Eminem", 10);
      // File:/Help:/Category: namespaces, the self-link, and the dup are all dropped;
      // the #anchor is stripped from the title.
      expect(r.links).toEqual(["Dr. Dre", "50 Cent", "D12 (band)"]);
      expect(r.title).toBe("Eminem");
    } finally { global.fetch = realFetch; }
  });

  it("caps the result at `max`", async () => {
    const html = `<a href="./A">A</a><a href="./B">B</a><a href="./C">C</a>`;
    const realFetch = global.fetch;
    global.fetch = vi.fn(async () => ({ ok: true, text: async () => html }));
    try {
      const r = await links("Root", 2);
      expect(r.links).toEqual(["A", "B"]);
    } finally { global.fetch = realFetch; }
  });

  it("returns null for a 404 article", async () => {
    const realFetch = global.fetch;
    global.fetch = vi.fn(async () => ({ ok: false, status: 404 }));
    try {
      expect(await links("Nope", 5)).toBeNull();
    } finally { global.fetch = realFetch; }
  });
});
