# Keeps llama-swap running on 127.0.0.1:8080 (the local model runner, infra/llm/README.md). Restarts it if it exits.
# WSL uses mirrored networking (.wslconfig), so the cloudflared tunnel in WSL reaches this port as localhost:8080.
$root = 'C:\moduli-llm'
$log = Join-Path $root 'logs\llama-swap.log'
while ($true) {
  "$(Get-Date -Format o) starting llama-swap" | Add-Content $log
  & (Join-Path $root 'llama-swap\llama-swap.exe') -config (Join-Path $root 'llama-swap\config.yaml') -listen 127.0.0.1:8080 2>&1 | Add-Content $log
  "$(Get-Date -Format o) llama-swap exited ($LASTEXITCODE), retry in 10s" | Add-Content $log
  Start-Sleep -Seconds 10
}
