#!/bin/sh
set -eu
umask 077
cd /opt/tech-scada
cat > /usr/local/bin/scada <<'EOF'
#!/bin/sh
set -eu
cd /opt/tech-scada
exec /usr/bin/docker compose --env-file .env.local -f docker-compose.server.yml -f docker-compose.small-server.yml "$@"
EOF
chmod 755 /usr/local/bin/scada
if [ ! -f deployment/database-imported ]; then
  scada exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot techmonitor' < deployment/scada-migration.sql
  scada exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot techmonitor -e "DELETE FROM sessions; DELETE FROM email_challenges; SELECT COUNT(*) AS migrated_users FROM users; SELECT COUNT(*) AS migrated_sensors FROM sensors;"'
  touch deployment/database-imported
fi
scada up -d --no-build
scada exec -T backend node smtp-check.js
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/scada-reload <<'EOF'
#!/bin/sh
set -eu
[ "${RENEWED_LINEAGE:-}" = '/etc/letsencrypt/live/scada.lut1x1337.ru' ] || exit 0
/usr/local/bin/scada exec -T frontend nginx -t
/usr/local/bin/scada exec -T frontend nginx -s reload
EOF
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/scada-reload
systemctl enable --now certbot.timer
scada ps
curl --retry 6 --retry-delay 2 --retry-connrefused --fail https://scada.lut1x1337.ru:9443/api/health
