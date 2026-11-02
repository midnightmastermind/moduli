# Lidarr via the reverse SSH tunnel (127.0.0.1:8100 on this host -> the PC). certbot adds TLS.
# The app's own login (Forms) guards it — never enable this site while the app's AuthenticationMethod is None.
server {
    listen 80;
    server_name music.viafluere.com;
    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:8100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
