# Registers the "Moduli media tunnel" task: runs at logon as the current user, no admin needed.
$script = Join-Path $PSScriptRoot 'media-tunnel.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Moduli media tunnel' -Action $action -Trigger $trigger -Settings $settings -User $env:USERNAME -Force | Out-Null
Start-ScheduledTask -TaskName 'Moduli media tunnel'
