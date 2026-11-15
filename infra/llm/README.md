# Local model runner (llama.cpp + llama-swap) on the PC

Jonah and the import clean-up talk to an OpenAI-compatible endpoint on the user's PC. Spec:
`docs/superpowers/specs/2026-11-15-local-llm-runner-design.md`, plan: `docs/superpowers/plans/2026-11-15-local-llm-runner.md`.

## Layout (`C:\moduli-llm`)
- `bin\` — llama.cpp Windows **Vulkan** build (b12387, `llama-b12387-bin-win-vulkan-x64.zip`).
- `models\` — `qwen2.5-coder-7b-q4_k_m.gguf` (build), `llama3.2-3b-q4_k_m.gguf` (fast). On a Windows disk:
  a Windows process reading a model from `\\wsl.localhost` crashed WSL twice (2026-11-14).
- `llama-swap\` — llama-swap v273 + `config.yaml` (copied from `llama-swap.yaml` here by `install-task.ps1`).
- `run.ps1` — keeps llama-swap on `127.0.0.1:8080`; log in `logs\llama-swap.log`.

## Models (both stay loaded)
| id | model | where | read | write |
|---|---|---|---|---|
| `build` | qwen2.5-coder 7B Q4_K_M | Radeon (`-ngl 99`) | ~50-58 tok/s | ~7-8 tok/s |
| `fast` | llama3.2 3B Q4_K_M | CPU (`--device none`) | ~91-98 tok/s | ~15 tok/s |

The 3B runs on the CPU because with the 7B on the Radeon there is no device memory left for a second model
(`ErrorOutOfDeviceMemory`, 2026-11-15), and writing speed is memory-bound either way.
qwen2.5-coder writes its tool call as text (`<tools>{...}</tools>`); Jonah recovers it (`parseContentToolCall`).

## Install / restart
- Install (no admin): run `install-task.ps1` in PowerShell. Task "Moduli LLM" starts at logon and restarts it.
- Restart: `Stop-ScheduledTask 'Moduli LLM'; Get-Process llama-swap,llama-server | Stop-Process -Force; Start-ScheduledTask 'Moduli LLM'`.
- Check: `curl http://127.0.0.1:8080/v1/models` (from WSL too — `.wslconfig` uses `networkingMode=mirrored`).

## Tunnel
cloudflared runs in WSL (`cloudflared.service`, config `~/.cloudflared/config.yml`, a copy is `cloudflared-config.yml`).
On `ollama.viafluere.com`, `^/v1/` goes to llama-swap (`localhost:8080`) and everything else to Ollama
(`localhost:11434`) until Ollama is removed. Same Cloudflare Access policy (service token). After editing:
`sudo systemctl restart cloudflared`.

## Swapping a model
Put the GGUF in `models\`, change its `cmd` in `llama-swap.yaml`, re-run `install-task.ps1`.
