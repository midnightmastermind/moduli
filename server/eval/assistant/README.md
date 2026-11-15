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
