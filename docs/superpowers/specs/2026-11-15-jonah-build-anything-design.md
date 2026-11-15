# Jonah builds anything — design

_2026-11-15. User: "we should be able to make any occurance with jonah" · "everything" · "editing and deleting should be
in there as well as undo. do that after the create" · practice target: the root Glossary page._

## Why
Jonah's 46 tools are one-record CRUD over REST. A local 3B–7B model cannot chain twenty calls reliably; every build
that worked was ONE call carrying the whole shape (`create_items` for CPS, `create_board` for Quick Links). Asked for
the Glossary (2026-11-15), Jonah made a board with invented URLs: it had no way to say "doc page, sections, link chips,
buttons".

## What gets built
**Phase 1 — one tool, `build` (create).** Jonah sends a tree; the server plans every record, resolves names against
the grid, writes them in a few bulk writes, broadcasts, and answers with what it made and what it could not.

Node kinds (each `{ <kind>: "Name", ...props, children? }`):
| node | makes | props |
|---|---|---|
| `page` | page occurrence in a folder | `kind` doc·board·canvas·table·folder (default doc), `in` folder path |
| `folder` | folder (+ its folder-page card) | `in` |
| `section` | container | `kind` doc·board·table·canvas (default = parent page's: doc page → doc), `filter` field name |
| `item` | instance row | `fields` {name: value}, `repeat` (as create_items) |
| `text` | textblock(s) from markdown | value is markdown |
| `link` | link chip (in a doc) or bookmark card (on a board) | `url` OR `to` (a page/folder name) |
| `image` / `file` | artifact by URL | `url` |
| `field` | a field definition | `type`, `options` |
| `button` | a button field on its parent + its operation | `does`: `open links` · `show page <name>` · `add item to <name>` |

- `under` (top level): an EXISTING occurrence/folder (name or path) the nodes are added into.
- Short forms: a string child is a link (`"Gmail | https://…"`, `"Schedule ->"` = in-app) or, failing that, an item.
- Rows in a doc parent are bullet lists of chips; sections end in one hover line (`docs/trailingEmpty`).
- Fields named that do not exist: left out and reported (same rule as create_items); select options added.
- One `build` = ONE transaction (`actionId`), so one undo takes it all back (Phase 2 makes undo reachable from Jonah).

**Phase 2 — edit, delete, undo.** `change` (rename, set fields, move, re-kind, add/remove a button), `remove`
(occurrence, with its subtree; asks first), `undo` (the last thing Jonah did, through the server's undo stack). Planned
after Phase 1 ships; same name resolution.

## Decisions (mine)
- Server-side planner (`services/buildPlan.js`, pure) + route `POST /api/v1/build`; the tool is a thin call. Pure so it
  is tested without a database; one route so a 50-record page is one round trip, not 50.
- Buttons reuse one operation per action kind (found by name, created if missing): "Links: Open in Browser" (FIND url
  chips under the pressed container → OPEN_URLS), "Panel: Show Page" per target, "Add Item" per container.
- `build` requires confirmation (like create_board): the drawer shows the plan summary first.
- The existing tools stay; the offline allowlist gains `build`.

## Checked by
`server/eval/assistant` on test grid 2 (cleaned up): the Glossary (sections, chips, in-app links, buttons), CPS and Quick
Links through `build`, and "add a section to an existing page". Pure planner tests; a client test driving the planned
Glossary's operations through the real executor.

## Not in scope
Authoring triggers/schedules ("every morning"), feeds, graphs, templates — later rounds.
