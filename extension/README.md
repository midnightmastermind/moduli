# Moduli Companion

A browser extension with one job today: **let Moduli open a web page inside a
panel.**

## Why it is needed

Most sites refuse to be framed. Measured against the user's own bookmarks:

```
en.wikipedia.org  frames
github.com        x-frame-options: deny
youtube.com       x-frame-options: sameorigin
reddit.com        x-frame-options: sameorigin
google.com        x-frame-options: sameorigin
danbrown.com      x-frame-options: sameorigin
```

Nothing in the app can change that — the browser is obeying the site. An
extension can, because `declarativeNetRequest` may modify response headers. This
is the same mechanism other bookmark tools use, which is why they appear to
frame pages that refuse a plain iframe.

Without the extension Moduli still works: **reader mode is the default** and
needs nothing installed. The extension is what makes the **Web** toggle useful
beyond the minority of sites that allow framing.

## What it does, and what it deliberately does not

`rules.json` removes `x-frame-options` and the two CSP headers — **only** for:

- `resourceTypes: ["sub_frame"]` — an iframe, never a page you navigate to
- `initiatorDomains: ["viafluere.com", "localhost"]` — a frame embedded by
  Moduli, never one embedded by any other site

**This scoping is the entire safety of the extension.** Those headers exist to
stop other sites framing a page and tricking you into clicking inside it
(clickjacking). Stripping them globally would remove that protection across your
whole browser. Stripping them only for frames Moduli itself embeds means the
protection is waived exactly where you have already decided to view the page,
and nowhere else.

`__tests__/extensionFramingRules.test.js` fails the build if that scoping is ever
widened.

## NOT VERIFIED HERE, and why

The rules are correct MV3 `declarativeNetRequest` and the scoping has six tests
that fail if it is ever widened — but **nobody has watched this unblock a page.**
Extensions do not load in this repo's headless Playwright environment. That was
established functionally rather than assumed: a throwaway extension whose only
rule BLOCKS a distinctive URL was loaded the same way, and the URL still
resolved. If DNR were active the request would have failed.

So the first real test is yours:

1. install below
2. open a bookmark or link in a panel and switch to **Web**
3. try `danbrown.com` — it sends `x-frame-options: SAMEORIGIN` and is blank
   without the extension

The same limit applies to the right-click menu when it is built.

## Install

**Chrome / Edge** — `chrome://extensions` → Developer mode → *Load unpacked* →
pick this folder.

**Firefox** — `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on*
→ pick `manifest.firefox.json`. (Firefox unloads temporary add-ons on restart;
signing is needed for a permanent install.)

## Not built yet

The right-click menu — selection → textblock, page → bookmark, link → bookmark,
image → artifact, posting to `POST /api/v1/ingest`. It is waiting on the
`Bookmark` module and its fields, which the bookmarks import creates; clipping
into a shape that does not exist yet would be guesswork.
