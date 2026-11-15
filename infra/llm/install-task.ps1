# Registers the "Moduli LLM" task: runs llama-swap at logon as the current user, no admin needed.
# Same shape as infra/media-tunnel/install-task.ps1. Copies run.ps1 + the config into C:\moduli-llm first.
$root = 'C:\moduli-llm'
Copy-Item (Join-Path $PSScriptRoot 'run.ps1') (Join-Path $root 'run.ps1') -Force
Copy-Item (Join-Path $PSScriptRoot 'llama-swap.yaml') (Join-Path $root 'llama-swap\config.yaml') -Force
$script = Join-Path $root 'run.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Moduli LLM' -Action $action -Trigger $trigger -Settings $settings -User $env:USERNAME -Force | Out-Null
Start-ScheduledTask -TaskName 'Moduli LLM'
