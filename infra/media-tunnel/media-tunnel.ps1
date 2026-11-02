# Keeps a reverse SSH tunnel to the droplet: 8097 -> Jellyfin 8096, 8098 -> Radarr 7878 (movie.),
# 8099 -> Sonarr 8989 (tv.), 8100 -> Lidarr 8686 (music.).
$log = Join-Path $env:TEMP 'media-tunnel.log'
$key = Join-Path $env:USERPROFILE '.ssh\moduli_tunnel'
while ($true) {
  "$(Get-Date -Format o) starting tunnel" | Add-Content $log
  & "$env:SystemRoot\System32\OpenSSH\ssh.exe" -N -i $key -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new -R 127.0.0.1:8097:127.0.0.1:8096 -R 127.0.0.1:8098:127.0.0.1:7878 -R 127.0.0.1:8099:127.0.0.1:8989 -R 127.0.0.1:8100:127.0.0.1:8686 tunnel@viafluere.com 2>&1 | Add-Content $log
  "$(Get-Date -Format o) tunnel exited ($LASTEXITCODE), retry in 10s" | Add-Content $log
  Start-Sleep -Seconds 10
}
