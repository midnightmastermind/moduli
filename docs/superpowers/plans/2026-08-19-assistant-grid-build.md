# Can the assistant build a workspace? — measured first, planned second

**User's ask:** use the AI assistant to reproduce `claude-grid`, as a test of whether it can
construct a workspace.

**Answer, measured 2026-08-19: not on the deployed configuration — and the binding constraint is
the TOOL ALLOWLIST, not the model.** Both halves were measured rather than argued, because a plan
written on a stale premise is the failure this repo keeps paying for.

---

## 1. What the assistant can reach

`selectToolsForBackend(tools, "ollama")`, run against the real catalog:

```
full catalog                       43 tools
visible on the ollama backend      19
hidden                             24
```

The deployed backend IS ollama (`ASSISTANT_BACKEND=ollama` in `server/.env`;
`ANTHROPIC_API_KEY` is commented out), so 19 is the live number.

**The five grid WRITE tools it can reach:**
`create_module`, `create_occurrence`, `set_occurrence_field`, `create_field`, `create_folder`
(plus `run_operation` and six Wikipedia/import tools).

**Three of the hidden 24 are individually disqualifying for a grid build:**

| hidden tool | why it blocks the task |
|---|---|
| `create_view` | A panel displays a page THROUGH a View. With no View the assistant can mint a panel module and a panel occurrence and the panel will render nothing — the exact `module-less` / unwired shape `gridIntegrity` reports. |
| `create_operation` | No automation of any kind. `claude-grid` has two composed operations and a live chart fed by one. |
| every `update_*` / `move_*` / `delete_*` | It cannot correct anything it creates. One wrong `create_module` is permanent within the session, and a build is mostly correction. |

**The allowlist is deliberate, not a misconfiguration.** `selectToolsForBackend` falls back to the
FULL catalog when the allowlist matches nothing, so an empty or broken list would present 43, not
19. `OFFLINE_CORE_TOOLS` is a curated set, and the code comment says why: a small model loses the
system prompt and the tool schemas when the context is crowded.

## 2. What the model does with them

Driven end to end against `test grid 2` (the seed's own target, never poms grid), one read-only
question, local `llama3.2:3b` — the model prod is configured for:

```
prompt     "How many containers are on this grid? Use the tools."
tool call  get_grid_state          (correctly chosen, correctly called)
elapsed    206.7 seconds
answer     "There are 1198 containers (modules) on the grid."     WRONG
```

It read `counts.modules: 1198` and reported modules as containers. So: the loop works, tool
selection works, and **one tool call costs three and a half minutes and the arithmetic was wrong.**

`claude-grid` is 65 modules, 4 panels, 4 pages, 6 containers, 14 fields, 19 records, 2 operations
and a chart. At one tool call per ~3.5 minutes, with no ability to fix a mistake, the task is not
reachable — and that is a statement about the configuration, not about whether the design is sound.

## 3. What would have to change, in order

1. **Widen the allowlist.** `OLLAMA_TOOL_ALLOWLIST` is an env var, so this is a config change
   rather than a code change. It must include at minimum `create_view`, `update_occurrence`,
   `update_module` and `delete_occurrence`; `create_operation` only once (3) is done, since
   composing a pipeline is the hardest thing in the catalog.
   **The tradeoff is real and is the reason the list is short:** more schemas in an 8k window means
   less room for the system prompt and the grid state. Measure the truncation before and after
   rather than assuming it holds.
2. **A bigger model, or the Anthropic backend.** `qwen2.5-coder:7b` is already pulled locally and
   is the tool-capable model the code's own comments recommend; the Anthropic path exists and is
   one uncommented key away. Re-run the §2 measurement on each and compare seconds-per-tool-call
   and whether the count comes back right.
3. **Then, and only then, attempt the build.**

## 4. The acceptance test, if someone does attempt it

Reproduce `claude-grid` on a THROWAWAY grid, never on poms grid, and verify with the checks that
grid was verified with in the first place:

```
checkGrid --grid <throwaway>        0 errors
panels / pages / containers         4 / 4 / 6, containers across board|doc|table|graph
fields                              >= 9 of the 11 types
a panel renders its page            i.e. a View exists and points at it
one operation runs and writes       run_operation returns effects, and the value lands
```

Anything less is a partial build, and a partial build with no `update_*` tools cannot be finished.

## 5. Worth recording regardless

The deck-vs-now audit quotes **48 tools**; the catalog is **43**, and the number a user's assistant
actually sees is **19**. Whichever figure ends up in the promo copy, it should be the third one —
that is the one that describes the product.
