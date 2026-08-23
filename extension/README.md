# Moduli Companion

A browser extension with two jobs: **let Moduli open a web page inside a panel**,
and **clip anything into your grid from the right-click menu.**

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


---

## Clipping

Right-click anywhere and send it to Moduli.

| what you right-click | what lands |
|---|---|
| selected text | a row with the text in `Excerpt` and the page in `URL` |
| the page | a bookmark |
| a link | a bookmark, **without visiting the link** |
| an image | an image artifact |

### Setting it up

Open the extension's options and fill in:

- **API token** — Command Center → Connections. It needs the `write` scope.
- **Grid id** — which grid to clip into.
- **Destination** *(optional)* — a container or page id. Leave it blank and
  clips are created unfiled; you can move them later.

It posts to `POST /api/v1/ingest`, which is **idempotent on (source,
externalId)** — so clipping the same page twice updates one row rather than
making two.

### What it deliberately does not do

- **A selection is not a real textblock yet.** `/ingest` writes `label`,
  `fields` and `meta`; a textblock's words live in a `textmap`, which is stored
  compressed and which that endpoint has no way to write. The text is kept in
  `Excerpt` and nothing is lost — but it is a field value, not a document.
- **A link clip does not fetch the link.** That is the point of the link
  context: bookmark it without opening it. It therefore has no cover and no
  excerpt until you open it in Moduli.

### Verifying it

**None of the clip path can be exercised in this repo's test environment** —
MV3 extensions do not load headlessly. What IS tested is everything that could
be decided wrongly:

- `clip.js` — which shape a context produces, what identity it carries, what a
  missing field id does (21 tests)
- `settings.js` — what a half-configured extension says instead of failing
  silently (12 tests)
- the manifests — that they ask for every permission the code uses, point at
  files that exist, declare the background as a module, and do not drift from
  each other (12 tests)

The rest — menu registration, storage, fetch, notifications — is verified by
installing it and clipping something.
