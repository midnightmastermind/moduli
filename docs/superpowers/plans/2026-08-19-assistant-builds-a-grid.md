# Can the assistant build a grid? — the test

**User, 2026-08-19:** *"come up with a plan to create that same grid you just did, but with the ai
assistant we have. i want to test if we can create a grid via that."*

The reference build is `claude-grid`, assembled by hand through the UI on 2026-08-18: 4 panels,
4 pages, 6 containers across board/doc/table/graph, 14 fields in 9 of the 11 types, 19 records,
2 composed operations, 1 live chart. **0 integrity errors.** That is the bar, and it is a fair one
because a person did it in one sitting.

---

## What the assistant can already do — measured

```
48 tools, and the CRUD is complete:
  create_module create_occurrence create_field create_operation create_view create_folder
  update_* / delete_* for each · set_occurrence_field · move_occurrence · copy_occurrence
  apply_template · run_operation · get_grid_state · list_* (7 of them)
  import_markdown · wikipedia_* (4) · read_file / write_file / list_dir / run_command
tool flags        `destructive` and `requires_confirm` already exist per tool
model             OLLAMA_MODEL, default "qwen2.5-coder:7b", local via the tunnel
                  (an Anthropic path also exists — ANTHROPIC_MODEL)
```

So the *vocabulary* is there. Every object claude-grid contains has a create tool.

## TWO BLOCKERS, both found by reading the tool pack rather than assuming

**1. There is no `create_grid` tool.** Zero matches. The assistant can populate a grid; it cannot
make one. So *"create a grid via the assistant"*, taken literally, is not possible today.

**2. The grid is baked into the tool pack.** `moduliToolPack({ baseUrl, apiToken, gridId })` closes
over one `gridId`, so every tool writes to the grid the chat was scoped to. The assistant cannot
switch grids mid-conversation even if a grid existed.

Together these decide the shape of the test: either **add `create_grid`** (small — the server
handler already exists, `App.jsx` calls it for the "Add new grid" button), or pre-create an empty
grid by hand and scope the chat to it.

**Recommendation: add the tool.** The alternative means the headline question — *can it create a
grid* — is answered "no, a human did that part", and the test is weaker for it. It is one tool
entry over an existing handler.

---

## The test

### Run it TWICE, and that is the whole design

Once on the local `qwen2.5-coder:7b`, once on the Anthropic path. **Without both arms a failure is
unattributable**: "the assistant could not build the grid" could mean the tools are insufficient or
that a 7B model cannot hold a 40-step plan, and those call for completely different work. The
two-arm result separates them.

### One prompt, not forty

The assistant gets the same brief a person got — a paragraph describing the workshop log — not a
step-by-step script. A test where the human supplies each step measures the tools; this is meant to
measure the assistant.

### Where it runs
A **throwaway grid on the claude-grid account**. Never `poms grid` — `assertNotProtected` covers
deletion, not population, and an assistant with `create_occurrence` and a 3,000-occurrence grid is
not something to point at live data on a first run.

---

## Tasks

1. **`create_grid` tool** over the existing handler, `destructive: false`. Returns the new gridId —
   and the tool pack has to be able to *re-scope* to it, or the assistant creates a grid it then
   cannot write to. That re-scoping is the real work in this task, not the tool.
2. **A scorecard**, filled from the DATABASE rather than from the transcript: panels, pages,
   containers by kind, fields by type, records, operations, charts, and `checkGrid` errors. The
   assistant's own account of what it did is not evidence.
3. **Run both arms**, capturing every tool call: name, arguments, result, and whether it errored.
   The per-call log is the finding even when the build succeeds.
4. **Compare against the manual build** on the same capability table Task 11 used, and record three
   numbers the transcript makes easy: total tool calls, failed calls, and calls that were retried.
5. **Report what it could not do**, in its own section, and resist fixing it in the same pass.

---

## What to watch for, because the manual build already told us

The hand build surfaced six defects. The interesting question is whether the assistant hits the same
ones or a different set — a tool path and a UI path reach the same handlers by different routes.

- **`create_module` had no gridId** until it was fixed server-side. The fix stamps it in the socket
  handler; **the assistant goes through the REST API**, so confirm the same stamping happens on that
  path before blaming the model for a vanishing container.
- **Graph containers could not be made** through any UI path. The assistant sets `kind` directly, so
  it may succeed where a person could not — which would be a nice demonstration and also a reminder
  that the tool surface and the UI surface are not the same product.
- **The operations editor's Save discarded work.** No equivalent exists for `create_operation`, so
  the assistant may build a working operation more reliably than the UI allowed.

## Risks

- **A 7B model with 48 tools.** The likeliest failure is not a bad tool call but losing the plan
  halfway. That is a finding, not a bug — and it is the reason for the second arm.
- **No dry run.** `wikipedia_import` takes a `dryRun`; the CRUD tools do not. A confused agent
  writes real rows. The throwaway grid is the containment.
- **`run_command` is in the pack.** A sandboxed shell alongside grid CRUD is a much larger surface
  than this test needs. Consider running the test with that tool withheld, and say so in the report
  — a build that succeeds without it is the stronger result.
