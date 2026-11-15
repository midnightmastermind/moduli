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
