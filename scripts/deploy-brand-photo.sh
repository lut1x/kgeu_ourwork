#!/bin/sh
set -eu
cd /opt/tech-scada
backup=/var/backups/tech-scada/brand-before-$(date +%Y%m%d-%H%M%S)
install -d -m 700 "$backup"
docker cp tech-scada-frontend-1:/usr/share/nginx/html "$backup/html"
tar -xzf /opt/tech-scada/frontend-brand-dist.tar.gz -C frontend
docker build -t tech-scada-frontend:deploy -f deploy/frontend-runtime.Dockerfile frontend
scada up -d --no-deps frontend
for attempt in 1 2 3 4 5; do
    if curl -fsS --max-time 10 https://scada.lut1x1337.ru:9443/api/health; then break; fi
    sleep 2
done
echo
curl -fsS --max-time 10 https://scada.lut1x1337.ru:9443/brand-photo.jpg | sha256sum
sha256sum frontend/public/brand-photo.jpg
curl -fsS --max-time 10 https://scada.lut1x1337.ru:9443/ | grep -o '/assets/[^" ]*'
