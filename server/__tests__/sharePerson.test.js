// A person shared to Moduli: vCard parsing and profile links (synthetic data).
import { describe, it, expect } from "vitest";
import { parseVcards, profileLinkInfo, profileFromHtml } from "../services/sharePerson.js";
import { classifyShare } from "../services/shareClassify.js";

describe("profileLinkInfo", () => {
  it("recognises Instagram, Facebook and TikTok profiles", () => {
    expect(profileLinkInfo("https://www.instagram.com/tim.clark/?igsh=abc")).toMatchObject({ network: "instagram", handle: "tim.clark" });
    expect(profileLinkInfo("https://m.facebook.com/tim.clark.5")).toMatchObject({ network: "facebook", handle: "tim.clark.5" });
    expect(profileLinkInfo("https://www.facebook.com/profile.php?id=1000123")).toMatchObject({ network: "facebook", handle: "1000123" });
    expect(profileLinkInfo("https://www.tiktok.com/@timclark")).toMatchObject({ network: "tiktok", handle: "timclark" });
  });
  it("posts, reels, groups and other sites are not profiles", () => {
    for (const u of ["https://www.instagram.com/p/Cx1/", "https://www.instagram.com/reel/Cx1/", "https://www.facebook.com/groups/123",
      "https://www.facebook.com/watch", "https://www.tiktok.com/@tim/video/1", "https://x.com/tim", "https://example.com/tim"]) {
      expect(profileLinkInfo(u)).toBeNull();
    }
  });
  it("the classifier calls a profile link `profile` and a .vcf `contact`", () => {
    expect(classifyShare({ url: "https://www.instagram.com/tim.clark/" }).type).toBe("profile");
    expect(classifyShare({ text: "check out https://www.tiktok.com/@timclark" }).type).toBe("profile");
    expect(classifyShare({ url: "https://www.instagram.com/p/Cx1/" }).type).toBe("link");
    expect(classifyShare({ files: [{ filename: "Tim.vcf", mimetype: "application/octet-stream" }] }).type).toBe("contact");
    expect(classifyShare({ files: [{ filename: "x", mimetype: "text/x-vcard" }] }).type).toBe("contact");
  });
});

describe("profileFromHtml", () => {
  const page = (title, image) => `<meta property="og:title" content="${title}" /><meta property="og:image" content="${image}" />`;
  it("reads the name and photo, per network", () => {
    const ig = profileFromHtml(profileLinkInfo("https://www.instagram.com/tim.clark/"),
      page("Tim Clark (&#064;tim.clark) &#x2022; Instagram photos and videos", "https://cdn/x.jpg?a=1&amp;b=2"));
    expect(ig).toMatchObject({ name: "Tim Clark", handle: "tim.clark", foundVia: ["instagram"], photo: { url: "https://cdn/x.jpg?a=1&b=2" } });
    expect(profileFromHtml(profileLinkInfo("https://www.tiktok.com/@timclark"), page("Tim Clark on TikTok", "i")).name).toBe("Tim Clark");
    expect(profileFromHtml(profileLinkInfo("https://facebook.com/tim.c"), page("Tim Clark", "i")).name).toBe("Tim Clark");
  });
  it("a login wall falls back to the handle and says the name was not read", () => {
    const p = profileFromHtml(profileLinkInfo("https://www.instagram.com/tim.clark/"), page("Instagram", ""));
    expect(p).toMatchObject({ name: "tim.clark", nameFromPage: false, photo: null });
  });
});

describe("parseVcards", () => {
  it("reads name, phone, email, birthday, company and an embedded photo", () => {
    const vcf = "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Clark;Tim;;;\r\nFN:Tim Clark\r\nORG:Acme\r\nTITLE:Engineer\r\n"
      + "TEL;TYPE=CELL:+1 555 0100\r\nEMAIL;TYPE=INTERNET:tim@example.com\r\nBDAY:1990-04-02\r\n"
      + "PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQ\r\n SkZJRg==\r\nEND:VCARD\r\n";
    const [p] = parseVcards(vcf);
    expect(p).toMatchObject({ name: "Tim Clark", phone: "+1 555 0100", email: "tim@example.com", birthday: "1990-04-02",
      company: "Acme", jobTitle: "Engineer", photo: { base64: "/9j/4AAQSkZJRg==", mime: "image/jpeg" } });
  });
  it("builds the name from N when there is no FN, and decodes quoted-printable", () => {
    const vcf = "BEGIN:VCARD\nVERSION:2.1\nN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Mu=C3=B1oz;In=C3=AAs\nEND:VCARD\n";
    expect(parseVcards(vcf)[0].name).toBe("Inês Muñoz");
  });
  it("a card with no name at all is skipped", () => {
    expect(parseVcards("BEGIN:VCARD\nTEL:1\nEND:VCARD\n")).toEqual([]);
  });
});

import { prepareShare } from "../services/shareIngress.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("prepareShare — a person", () => {
  const stored = [];
  const storeFile = async ({ file }) => { stored.push(file); try { fs.unlinkSync(file.path); } catch {} return { occurrenceId: `photo${stored.length}` }; };

  it("a .vcf becomes $share.person with its photo stored, and the card file is not kept", async () => {
    stored.length = 0;
    const tmp = path.join(os.tmpdir(), `t-${Date.now()}.vcf`);
    fs.writeFileSync(tmp, "BEGIN:VCARD\nFN:Tim Clark\nTEL:555\nPHOTO;ENCODING=b;TYPE=PNG:iVBORw0KGgo=\nEND:VCARD\n");
    const share = await prepareShare({ userId: "u", gridId: "g", storeFile,
      files: [{ filename: "Tim.vcf", mimetype: "text/x-vcard", size: 10, path: tmp }] });
    expect(share.type).toBe("contact");
    expect(share.person).toMatchObject({ name: "Tim Clark", phone: "555", photoOccurrenceId: "photo1", photoIds: ["photo1"] });
    expect(share.label).toBe("Tim Clark");
    expect(share.externalId).toBe("contact:tim clark");
    expect(stored).toHaveLength(1);            // the photo — NOT the .vcf
    expect(stored[0].mimetype).toBe("image/png");
    expect(fs.existsSync(tmp)).toBe(false);
  });

  it("a profile link is read from its page and keyed on the person", async () => {
    stored.length = 0;
    const share = await prepareShare({ userId: "u", gridId: "g", storeFile,
      url: "https://www.instagram.com/tim.clark/?igsh=1",
      fetchProfile: async () => '<meta property="og:title" content="Tim Clark (@tim.clark) • Instagram photos and videos"><meta property="og:image" content="https://cdn/p.jpg">',
      fetchImage: async () => ({ buf: Buffer.from([1, 2, 3]), type: "image/jpeg" }) });
    expect(share.type).toBe("profile");
    expect(share.person).toMatchObject({ name: "Tim Clark", network: "instagram", handle: "tim.clark", photoIds: ["photo1"] });
    expect(share.externalId).toBe("profile:instagram:tim.clark");
  });

  it("a card with no name is refused, not added nameless", async () => {
    const tmp = path.join(os.tmpdir(), `t2-${Date.now()}.vcf`);
    fs.writeFileSync(tmp, "BEGIN:VCARD\nTEL:1\nEND:VCARD\n");
    await expect(prepareShare({ userId: "u", gridId: "g", storeFile,
      files: [{ filename: "x.vcf", mimetype: "text/vcard", size: 1, path: tmp }] })).rejects.toMatchObject({ code: "empty_contact" });
  });
});
