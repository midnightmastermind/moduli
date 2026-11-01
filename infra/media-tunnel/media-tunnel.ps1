# Keeps a reverse SSH tunnel: droplet 127.0.0.1:8097 -> local Jellyfin 8096.
$log = Join-Path $env:TEMP 'media-tunnel.log'
$key = Join-Path $env:USERPROFILE '.ssh\moduli_tunnel'
while ($true) {
  "$(Get-Date -Format o) starting tunnel" | Add-Content $log
  & "$env:SystemRoot\System32\OpenSSH\ssh.exe" -N -i $key -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new -R 127.0.0.1:8097:127.0.0.1:8096 tunnel@viafluere.com 2>&1 | Add-Content $log
  "$(Get-Date -Format o) tunnel exited ($LASTEXITCODE), retry in 10s" | Add-Content $log
  Start-Sleep -Seconds 10
}
