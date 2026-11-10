#!/bin/sh
set -eu
umask 077
cd /opt/tech-scada
stamp=$(date +%Y%m%d-%H%M%S)
backup=/var/backups/tech-scada/direct-registration-$stamp
install -d -m 700 "$backup" deployment/direct-registration
systemctl start scada-backup.service
tar -czf "$backup/source-before.tar.gz" backend/auth.js frontend/dist
docker tag tech-scada-backend:ip "tech-scada-backend:before-direct-$stamp"
tar -xzf deployment/direct-registration.tar.gz -C deployment/direct-registration
install -m 644 deployment/direct-registration/backend/auth.js backend/auth.js
DOCKER_BUILDKIT=0 scada build backend
scada up -d --no-build --no-deps --wait --wait-timeout 240 backend
cp -a deployment/direct-registration/frontend/dist/. frontend/dist/
scada exec -T frontend nginx -t
scada exec -T frontend nginx -s reload
curl --fail --silent --show-error --max-time 30 https://170.168.150.194/api/health
systemctl start scada-backup.service
scada ps
printf '\nSource backup: %s\n' "$backup"
