#!/bin/sh
set -eu
umask 077
cd /opt/tech-scada
tar -xzf deployment/scada-project.tar.gz
chmod 600 .env.local deployment/scada-migration.sql
python3 - <<'PY'
from pathlib import Path
import secrets
p = Path('.env.local')
lines = p.read_text(encoding='utf-8-sig').splitlines()
values = dict(line.split('=', 1) for line in lines if '=' in line and not line.startswith('#'))
updates = {'SCADA_DOMAIN': 'scada.lut1x1337.ru', 'APP_URL': 'https://scada.lut1x1337.ru:9443', 'COOKIE_SECURE': 'true', 'MAIL_MODE': 'smtp', 'DB_ROOT_PASSWORD': values.get('DB_ROOT_PASSWORD') or secrets.token_hex(32)}
lines = [line for line in lines if line.split('=', 1)[0] not in updates]
p.write_text('\n'.join(lines + [f'{k}={v}' for k,v in updates.items()])+'\n', encoding='utf-8')
PY
docker load -i deployment/scada-images.tar
docker compose --env-file .env.local -f docker-compose.server.yml -f docker-compose.small-server.yml config --quiet
if [ ! -f /etc/letsencrypt/live/scada.lut1x1337.ru/fullchain.pem ]; then
  mail_address=$(sed -n 's/^SMTP_USER=//p' .env.local)
  certbot certonly --standalone --preferred-challenges http --cert-name scada.lut1x1337.ru -d scada.lut1x1337.ru --non-interactive --agree-tos --email "$mail_address"
fi
docker compose --env-file .env.local -f docker-compose.server.yml -f docker-compose.small-server.yml up -d --wait --wait-timeout 240 mysql
if [ ! -f deployment/database-imported ]; then
  docker compose --env-file .env.local -f docker-compose.server.yml -f docker-compose.small-server.yml exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot techmonitor' < deployment/scada-migration.sql
  docker compose --env-file .env.local -f docker-compose.server.yml -f docker-compose.small-server.yml exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot techmonitor -e "DELETE FROM sessions; DELETE FROM email_challenges;"'
  touch deployment/database-imported
fi
docker compose --env-file .env.local -f docker-compose.server.yml -f docker-compose.small-server.yml up -d --no-build
docker compose --env-file .env.local -f docker-compose.server.yml -f docker-compose.small-server.yml exec -T backend node smtp-check.js
