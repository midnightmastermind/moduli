# Moduli Clock (Bangle.js 2)

A Casio-style clock face. Bottom row: play/pause (phone media) · POMO (pomodoro
on the watch) · AI (opens the phone's default assistant) · + (add a textblock
to Moduli through `POST /api/v1/share`).

## Files on the watch
- `moduliclock.app.js` — the face
- `moduliclock.info` — app record (the face rewrites it if it reads back wrong)
- `moduliclock.json` — your settings, from `moduliclock.example.json`. Holds an
  API token, so it is gitignored. `parentId` `gvukb3iby2` = the Lookup board
  on poms grid. Optional: `pomoWork`, `pomoBreak` (minutes), `voice` (intent
  override: `action`, `package`, `class`, `categories`).

## Uploading (Espruino Web IDE, Chrome/Edge — not Firefox)
- Phone Bluetooth off, or Gadgetbridge force-stopped: the watch takes one
  connection at a time.
- Paste a file into the editor, ▾ next to upload → **Storage** → its exact name
  → upload. **Never Flash**: that replaces the boot code.
- Check: `require("Storage").list("moduli")`.

## Problems seen 2026-10-21
- **Clock never starts after a hand upload:** the 7-segment font module is
  missing. Fixed — the face falls back to the Vector font.
- **Button bounces from the app screen to the clock:**
  - "Reloading…" each time → broken boot code; reinstall **Bootloader** from
    the App Loader.
  - No message → **Fast Reset** (`fastreset.boot.js`) jumps to the clock 250ms
    after the button goes down, so a normal press closes the launcher. Remove it.
- **IDE "Connection failed":** turn on Settings › Bluetooth › Programmable;
  remove the watch from Windows Bluetooth; close old IDE tabs.
- **AI opened a chooser:** `VOICE_COMMAND` opens one, and Claude does not
  handle it. The face sends `VOICE_ASSIST` now.
