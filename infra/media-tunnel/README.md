# Media tunnel (Jellyfin -> media.viafluere.com)

PC runs Jellyfin on :8096. A reverse SSH tunnel publishes it on the droplet at 127.0.0.1:8097; nginx (`infra/nginx/media.viafluere.com`) proxies it with TLS.

1. Droplet (root): `useradd -m -s /usr/sbin/nologin tunnel`; `/home/tunnel/.ssh/authorized_keys` =
   `restrict,port-forwarding,permitlisten="127.0.0.1:8097" <contents of moduli_tunnel.pub>` (chown tunnel, 700/600).
2. PC: `ssh-keygen -t ed25519 -N "" -f C:\Users\jtpom\.ssh\moduli_tunnel`.
3. Copy `media-tunnel.ps1` + `install-task.ps1` to `C:\Users\jtpom\moduli-media-tunnel\` (local disk, so logon does not depend on WSL) and run `install-task.ps1` (task "Moduli media tunnel", at logon, restart on failure; it also starts it).
   Log: `%TEMP%\media-tunnel.log`. Verify on the droplet: `curl -s 127.0.0.1:8097/System/Info/Public`.
4. DNS (Cloudflare, DNS-only): A `media` -> 142.93.5.142. Copy the nginx file to `/etc/nginx/sites-available/`, symlink into `sites-enabled`, `nginx -t && systemctl reload nginx`, `certbot --nginx -d media.viafluere.com`.
5. Jellyfin (done via API): KnownProxies `127.0.0.1`; RemoteClientBitrateLimit 4 Mbps; hardware acceleration AMF, HW decoding h264/hevc, HW encoding on; user `friend` (non-admin, Movies/Shows/Documentaries); API key "Moduli". Secrets are kept outside git.

## Measurements
- ffmpeg h264_amf (d3d11va decode, 1080p, 2 Mbps) on a film clip: ~4.3x realtime, so GPU encoding works.
- Jellyfin's own transcode over media.viafluere.com (HEVC 1080p film, MaxStreamingBitrate 2 Mbps): log `FFmpeg.Transcode-*.log` shows `-hwaccel d3d11va` and `-codec:v:0 h264_amf` (`hevc (native) -> h264 (h264_amf)`); 4 segments downloaded, 0.6-2.2 MB each.
- Upload from the PC (curl to speed.cloudflare.com/__up) while on the hotel wifi: ~1.2 MB/s (~9.6 Mbps). This is the hotel figure.
