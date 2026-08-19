# Skins, a Stardew Valley theme, and a style cascade by occurrence type

**User, 2026-08-19:** *"make my current styling (the retro rainbow look) a default skin, and then
change my main grid to use the background i just saved in the screenshots folder, and changing the
lettering and borders and backgrounds to match the lettering in star dew valley. this is a star dew
valley theme. if we dont have a ui for changing these things in the grid globally (maybe by
occurance type), we should create it, so i can change the lettering all at once. but id like a star
dew valley skin/theme. we need a ui to change the theme of the grid. and cascade by occurance type."*

---

## What exists today — MEASURED, not assumed

Everything below was read out of the source or the live database before any of this was planned.

```
THEMES            5 already exist: moduli-dark, moduli-light, midnight, vintage-light, vintage-dark
                  ~71 CSS custom properties each, in [data-theme="..."] blocks (index.css:49-631)
PICKER            AppearanceTab already has a theme picker + a free-form token override editor
PERSISTENCE       localStorage["moduli-theme"]  (helpers/useTheme.js:63)
STYLE CASCADE     StyleHelpers: Grid → Panel → Page → Container → Instance, per PLACEMENT
                  grid.meta.defaultStyle is the root; STYLE_FIELDS_BY_KIND already lists
                  fontFamily / fontSize / fontWeight / lineHeight / borderColor / bg per entity kind
CHOKEPOINT        styleToCSS() is the ONE place a stored colour becomes CSS — proven on 2026-08-17,
                  when the surface-alpha cap was applied there for exactly this reason
```

### FOUR FINDINGS THAT SHAPE THE WHOLE PLAN

**1. The retro rainbow is NOT a theme, and that is why this is real work.**
`--retro-rainbow`, `--retro-header-scrim`, `--retro-panel-scrim`, `--grid-wallpaper`,
`--grid-wallpaper-scrim` and `--grid-surface-a` live in a **bare `:root`** at `index.css:6087` —
*outside every `[data-theme]` block*. So they apply to all five themes at once, and switching theme
today **does not change the wallpaper or the rainbow at all**. Making the current look "a default
skin" means moving those six tokens into a named block, which is also what makes a second skin
possible.

**2. The theme is per-BROWSER, not per-grid.** `useTheme` reads and writes
`localStorage["moduli-theme"]`. *"Change my main grid to use the background"* is therefore not
expressible today: picking Stardew would restyle **every** grid on that machine, and would not
follow the user to another device. Per-grid skin selection is the central missing piece.

**3. THERE IS NO WEBFONT AT ALL — the "lettering" is currently whatever the OS provides.**
`@fontsource/jetbrains-mono` is in `package.json` and is **never imported**: no `@font-face` in the
stylesheet, no `.woff2` in `client/dist`, and none served by production (checked). So
`--font-mono: "JetBrains Mono", ui-monospace, …` falls through to the system monospace on every
machine, and the app looks different on Windows, macOS and Linux today. **A pixel font for Stardew
needs a font pipeline that does not exist yet.** This is a prerequisite, not a detail.

**4. THE BIGGEST RISK, measured on the live data: poms grid carries 424 STORED colours.**
```
poms grid    3161 modules / 3272 occurrences
             315 modules with ownStyle.bg   →  231 instance · 73 container/board · 11 container/doc
             109 occurrence placements with ownStyle.bg
             grid.meta.defaultStyle: none
claude-grid  0 stored colours anywhere
```
`ownStyle.bg` renders as an **inline style**, which beats any stylesheet rule at any specificity
(CLAUDE.md 2026-08-17, the entry that had to apply the alpha cap in JS for this exact reason).
**So switching poms grid to a Stardew skin will change the wallpaper and the chrome and leave 424
surfaces in the nine-dimension vintage palette** — rust, plum, teal, avocado, mustard — sitting on
a pixel-art farm. A skin that only writes CSS cannot fix that, and this is the decision the whole
theme rests on (see Task 5). claude-grid, by contrast, will look right from CSS alone.

---

## Shape of the change

```
  SKIN            named token set, DATA not code — wallpaper, palette, fonts, scrims
    ↓             selected per GRID (grid.meta.skin), falling back to the user's localStorage pick
  GRID DEFAULT    grid.meta.defaultStyle                       (exists)
    ↓
  TYPE DEFAULTS   grid.meta.typeStyles["container/doc"] etc.   (NEW — "change the lettering all at once")
    ↓
  PLACEMENT       panel → page → container → instance          (exists)
    ↓
  PER-PLACEMENT   occurrence.ownStyle                          (exists, final say)
```

The type layer slots in **one `pushLevel` call** below the grid root in `resolveStyleCascade`, which
already builds an ordered `levels[]` and merges top-down. Nothing about the placement chain moves.

**Type key is `role/kind`** (`container/board`, `container/doc`, `instance/-`, `textblock/doc`,
`page/board`, `artifact/image`, …) — the same string `checkGrid` and the orphan sweep already use to
describe a module, so there is one vocabulary rather than a second one invented here.

---

## Tasks

### Task 1 — The font pipeline (PREREQUISITE)
Nothing about "the lettering" is expressible until a webfont actually loads.
- Import `@fontsource/jetbrains-mono` (already a dependency, never imported) so the current look is
  the same on every machine instead of accidentally system-dependent.
- Add a pixel face for the Stardew skin. Stardew's own font is proprietary; the closest free
  equivalents are **VT323**, **Silkscreen** or **Press Start 2P** (all SIL/OFL, all on fontsource).
  Self-hosted via fontsource — no external font CDN, so nothing new is fetched at runtime.
- `--font-display` joins `--font-mono` as a token, so a skin can set headings and body separately.
- **Verify by measurement, not by looking:** assert the `.woff2` is in `dist`, is served by prod, and
  that `document.fonts.check()` reports the family loaded. A font that silently fails to load is
  indistinguishable from one that was never added — which is exactly today's state.

### Task 2 — Make the current look a NAMED SKIN, byte-identical
- Move the six bare-`:root` tokens into `[data-skin="retro-rainbow"]`.
- `retro-rainbow` becomes the default skin, so an untouched grid renders exactly as it does now.
- **The proof this task is done is a screenshot diff, not a passing test:** the same grid at the same
  width before and after must be pixel-identical. This is a refactor; anything visible is a bug.
- **Skin and THEME stay separate axes.** A theme owns the ~71 surface/text/signal tokens (and there
  are five); a skin owns wallpaper, scrims, fonts and palette. Collapsing them would mean re-authoring
  five themes to get one wallpaper.

### Task 3 — Skin selection PER GRID
- `grid.meta.skin` — read by App at mount and on every grid switch, written by the picker.
- Precedence: `grid.meta.skin` → user's localStorage pick → `retro-rainbow`. So the user's existing
  choice still applies to any grid that has not named one.
- Applied by stamping `data-skin` on the root element beside the existing `data-theme`, which is the
  mechanism already proven for themes.
- **Watch the swap on grid change:** the wallpaper is a background-image, so switching grids will
  fetch a new one. Preload, or the first frame of the new grid flashes unstyled.

### Task 4 — The Stardew Valley skin
- **Wallpaper:** one of the two saved this morning (see Question 1). Copied into `client/public/`;
  the source jpgs stay in `screenshots/`.
- **Palette from the art rather than invented:** barn red, farm green, sky blue, wood brown, wheat.
- **Chrome:** Stardew's UI is a thick warm-wood panel with a lighter inner bevel and near-black
  lettering — so this skin wants `borderWidth: 3px`, a low `borderRadius`, and a *light* surface with
  dark text. Every one of those is an existing token; none of it is new machinery, which is the point
  of Task 2.
- **The scrim is the readability knob**, exactly as CLAUDE.md 2026-08-17 records: raise
  `--grid-wallpaper-scrim` until the type has its background back. Do not chase surface alpha.

### Task 5 — The 424 stored colours  ← THE DECISION (see Question 2)
Three options, and only the first keeps what those colours MEAN:
- **(a) Palette remap at the chokepoint.** A skin declares `paletteMap`, and `styleToCSS` — the one
  place a stored colour becomes CSS, already carrying `withSurfaceAlpha` for this same reason — maps
  each stored hue to the skin's nearest equivalent. The nine dimensions stay distinguishable; the
  grid changes character. **Reversible, because nothing in the data is rewritten.**
- **(b) Suppress.** The skin ignores `ownStyle.bg` and everything takes skin surfaces. One flag,
  instantly consistent, and the nine-dimension colour coding is gone while it is on.
- **(c) A migration that rewrites all 424.** Destructive, one-way, and it defeats the point of a skin
  — you could never switch back.
**Recommendation: (a), with (b) available as a per-skin flag.** Both are reversible; (c) is not.

### Task 6 — The type layer in the cascade
- `grid.meta.typeStyles: { "<role>/<kind>": styleObject }`, merged after the grid root.
- `resolveStyleCascade` gains one `pushLevel`; `buildStyleCascadeContext` learns to look the type up.
- **The existing editor already renders whatever level list it is handed**, so the read-only
  "Inherited cascade" view surfaces the new row for free.
- Keys are only ever set for types the grid actually contains — read from the grid, not from a
  hardcoded list, so a new container kind cannot silently miss out.

### Task 7 — The UI
In `AppearanceTab`, beside the theme picker:
- **Skin picker** — swatch per skin, applies to THIS grid, with a clear note about scope.
- **Per-type style editor** — the type list is derived from the grid's own modules (with counts, so
  "container/board · 73" tells the user what they are about to change), each opening the existing
  `StyleEditor` filtered by `STYLE_FIELDS_BY_KIND`. **This is the "change the lettering all at once"
  surface.**
- The existing free-form token override editor stays; it is the escape hatch.

### Task 8 — Verification
- Screenshots at 1440×900 and 390×844, on **both** grids, **looked at** — a skin is a visual change
  and this repo has been wrong about visual changes it only measured (2026-08-17, three rounds).
- Contrast measured, not eyeballed: sample painted pixels behind body text and assert a floor. The
  2026-08-17 entry records a probe whose numbers disagreed with the screenshot and the screenshot was
  right — so if they disagree again, believe the picture and fix the probe.
- `checkGrid` on both grids: **0 errors**, since none of this touches occurrence structure.
- The `noDomainKnowledge` guard still passes — a skin must not teach the renderer what a "farm" is.

---

## Risks

- **The 424 stored colours (Task 5).** The one that decides whether this looks finished or half-applied.
- **Contrast.** Stardew's own UI is dark-on-light; five of the app's tokens assume light-on-dark. The
  skin must set the full token set, not a subset, or text goes light-on-light somewhere.
- **A skin that only half-applies is worse than none.** If `data-skin` reaches the grid surface but
  not the toolbar or the Command Center, the app reads as broken rather than themed. Enumerate the
  surfaces first.
- **Per-grid skin + per-browser theme can contradict** (a light theme under a dark skin). Either the
  skin pins the theme, or the picker warns. Decide in Task 3 rather than discovering it.

---

## Decisions (user, 2026-08-19)

1. **Wallpaper: the FARMHOUSE SUNSET on the grid** (`stardew-valley-farmhouse-sunset-pixel-art…jpg`,
   3840×2160). Chosen over my recommendation, so the readability work moves from "nice to have" to
   load-bearing: the art is busy edge to edge and hot in the mid-tones, and the scrim is what buys
   the type its background back. **Task 4 therefore measures contrast rather than eyeballing it**,
   and if the scrim needed to make text legible mutes the art past the point of being worth it, that
   is a finding to report — not something to quietly settle at an unreadable value.
2. **Remap the 424 stored colours** to a Stardew palette at `styleToCSS`. Nothing in the data is
   rewritten, so the switch is reversible and the nine dimensions stay distinguishable.
3. **Skin is chosen PER GRID** (`grid.meta.skin`), falling back to the user's existing localStorage
   pick, then to `retro-rainbow`.
