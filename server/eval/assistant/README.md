# Assistant eval (local LLM plan, Task 6)

Runs Jonah's real code in-process against **test grid 2** on prod's REST API (a scratch token, revoked after), times
each case in `cases.json`, checks the result in Mongo, and deletes every row it made (through the REST API, so prod's
warm cache drops them too). Never point it at poms grid; it refuses a protected grid.

    cd server
    ASSISTANT_BACKEND=local LLM_URL=http://127.0.0.1:8080 node --env-file=.env eval/assistant/run.mjs --label llama
    # the Ollama baseline: the old code from a checkout before the switch
    ASSISTANT_BACKEND=ollama OLLAMA_URL=http://localhost:11434 OLLAMA_MODEL=llama3.2:3b \
      node --env-file=.env eval/assistant/run.mjs --label ollama --agent <old checkout>/server/services/assistantAgent.js

`--only <case>` runs one case. Results go to `results/` (git-ignored).

test grid 2 has no Schedule Type field, so its CPS case asks for date, time and duration only.

## 2026-11-15 — first runs

Ollama baseline (prod's setup: llama3.2 3B, Ollama in WSL, old code):

| case | wall | passed | what happened |
|---|---|---|---|
| cps | 124s | no | container written as `Tasks Â· Appointments` (garbled `›`), items as a JSON string with fields at the top level |
| quicklinks | 60s | no | 13 bookmarks, no board page named, no types, no filter |
| q-schedule | 15s | yes | |
| q-feeds | 7s | yes | |
| q-movies | 60s | yes | "0 occurrences" (wrong, but it wrote nothing) |

New runner (llama-swap: qwen2.5-coder 7B on the Radeon for builds, llama3.2 3B on the CPU for questions):

| case | wall | first token | passed | what happened |
|---|---|---|---|---|
| quicklinks | 60s | 6s | **yes** | 13 bookmarks in the one-line form, typed, filter set; 4,325 of 4,516 prompt tokens reused |
| cps (×4) | 24-123s | 1-100s | no | the call written as text once; dates from "today" not Nov 1; "Schedule Type" copied from the example |
| q-schedule | 20s | 14s | yes | |
| q-feeds | 7s | 3s | yes | |
| q-movies | 166s | — | no | the 3B called create_board for a question → questions now get read tools only |

Fixes from these runs: questions get read tools only; a garbled `›` still splits a path; a field the grid lacks is
left out instead of failing the row.

## 2026-11-15 — after the fixes, build model Qwen2.5 7B Instruct (Q4_K_M)

qwen2.5-coder 7B wrote its tool calls as text (`<tools>{…}</tools>`) and failed CPS 4 of 4; Qwen2.5 7B Instruct uses
the native tool-call channel and is the build model now. Two more fixes from these runs: a named month in `repeat`
means the whole month (the model started from "today"), and a value of the wrong kind ("Day": "Mon" on a number field)
is left out instead of failing the row.

| case | model | wall | passed | notes |
|---|---|---|---|---|
| cps | build | 24-28s (×4) | **4 of 4** | 17 rows, Nov 2 – Nov 30, Mon-Thu |
| quicklinks | build | 100-107s (×3) | **3 of 3** | 13 typed bookmarks + filter; it also calls an unneeded add_filter |
| q-schedule | fast | 38s | yes | answered from its notes, not today's slots |
| q-feeds | fast | 6s | yes | |
| q-movies | fast | 34s | yes | wrote nothing; said "no movies" (test grid 2's board was not found) |

Questions on the 3B are no better than Ollama's answers were — the same model. A video playing on the PC shares the
Radeon and memory; the measured speeds were unchanged (51 tok/s read, 7 write on the 7B).

## 2026-11-15 — `build` (make anything), glossary practice

The glossary case asks for a doc page with page/folder links and quick links by category with open-in-browser buttons.
Before `build` Jonah made a board with invented URLs. With `build`:

| round | what changed | passed |
|---|---|---|
| tree form only | Jonah put every link inside its own button, or used create_board | 0 of 5 |
| + markdown content (`page.markdown`) | sections and web links right; in-app links as `[Name](Name)`, the button as a javascript: link | 0 of 2 |
| + those habits read as meant | | 1 of 3 |
| + several links a line, bold sub-sections, `[Open all]`, a stray button goes on the page | | **2 of 4** (50-60s each) |

The remaining misses are the model linking to `#anchors` or inventing addresses (`https://example.com/schedule`), which
parsing cannot fix. CPS 6 of 7 and Quick Links 4 of 4 through their own tools after the prompt change (one CPS miss: the
weekdays written as a field — model variance; the next two passed).

## 2026-11-15 (2) — self-check, forced tool call, preview card

- **Self-check** (`assistantAgent.holdForConfirm`): a build is practice-run first (`/build` dryRun); problems on the
  first check go back to the model once, and its corrected call becomes the card.
- **Forced call**: `tool_choice: "required"` on the build model's first turn and on the turn after a send-back.
- First round (forced first turn only): glossary **1 of 4** — twice the model answered the send-back in words
  ("let's correct this") and built nothing. Forcing the turn after a send-back too: glossary **3 of 4** (42-84s);
  one run's self-check visibly fixed a link to "Scheduling" before the card. The miss: the forced call picked
  `create_occurrence`. CPS 2 of 2 (25s; one miss in the first round, the known weekdays-as-a-field habit),
  Quick Links 1 of 1.

## 2026-11-15 (3) — "did you mean", call-only send-backs, editing cases

- llama-server DOES honour `tool_choice: "required"`, but lets the model write text first and only then the call
  (measured directly: asked to "just say hello", it wrote text, then garbage, then a build call). At ~7 tok/s that text
  ate the request's time — the one failing glossary run stopped mid-sentence at 240s.
- The send-back now asks for ONLY the corrected call, and an unknown page name carries a suggestion
  (`buildPlan.closestName`: "Scheduling" → "did you mean \"Schedule\"?" — still a question, never a silent guess).
- **Glossary 4 of 4** (85-140s; each needed one send-back, each corrected call clean).
- New cases (`setup` builds a page over REST first; cleanup removes it): **edit-rename 3/3** (~5s), **edit-undo 3/3**,
  **edit-remove 2/2** after the fix — it was 0/2: the model named "Social section from Eval Notebook page"; the
  route now reads that as "Eval Notebook › Social" (`buildEdit.normalizeTargetName`) and the tools describe the
  path form. "undo/change/edit/update/fix" now route to the build model (undo went to the read-only one).
- CPS 1/1 (25s), Quick Links 1/1 (94s) after the changes.
