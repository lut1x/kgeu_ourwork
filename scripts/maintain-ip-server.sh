#!/bin/sh
set -eu
umask 077
install -d -m 700 /var/backups/tech-scada
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/scada-ip-reload <<'EOF'
#!/bin/sh
set -eu
/usr/local/bin/scada exec -T frontend nginx -t
/usr/local/bin/scada exec -T frontend nginx -s reload
EOF
chmod 700 /etc/letsencrypt/renewal-hooks/deploy/scada-ip-reload
/opt/certbot/bin/certbot reconfigure --cert-name 170.168.150.194 --webroot --webroot-path /var/www/acme --non-interactive
cat > /etc/systemd/system/scada-certbot.service <<'EOF'
[Unit]
Description=Renew SCADA IP certificate
After=docker.service
[Service]
Type=oneshot
ExecStart=/opt/certbot/bin/certbot renew --quiet --no-random-sleep-on-renew
EOF
cat > /etc/systemd/system/scada-certbot.timer <<'EOF'
[Unit]
Description=Check SCADA IP certificate every six hours
[Timer]
OnCalendar=*-*-* 00,06,12,18:15:00 UTC
RandomizedDelaySec=600
Persistent=true
[Install]
WantedBy=timers.target
EOF
cat > /usr/local/sbin/scada-backup <<'EOF'
#!/bin/bash
set -euo pipefail
umask 077
dir=/var/backups/tech-scada
stamp=$(date +%Y%m%d-%H%M%S)
install -d -m 700 "$dir"
/usr/local/bin/scada exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --no-tablespaces --set-gtid-purged=OFF techmonitor' | gzip > "$dir/database-$stamp.sql.gz.partial"
gzip -t "$dir/database-$stamp.sql.gz.partial"
mv "$dir/database-$stamp.sql.gz.partial" "$dir/database-$stamp.sql.gz"
install -m 600 /opt/tech-scada/.env.local "$dir/environment-$stamp.env"
find "$dir" -maxdepth 1 -type f \( -name 'database-*.sql.gz' -o -name 'environment-*.env' \) -mtime +7 -delete
EOF
chmod 700 /usr/local/sbin/scada-backup
cat > /etc/systemd/system/scada-backup.service <<'EOF'
[Unit]
Description=SCADA database backup
Requires=docker.service
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/scada-backup
Nice=10
EOF
cat > /etc/systemd/system/scada-backup.timer <<'EOF'
[Unit]
Description=Daily SCADA backup at 06:30 Moscow
[Timer]
OnCalendar=*-*-* 03:30:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
EOF
install -m 644 /opt/tech-scada/deploy/scada-stack.service /etc/systemd/system/scada-stack.service
systemctl daemon-reload
systemctl enable --now scada-stack.service scada-certbot.timer scada-backup.timer
systemctl start scada-backup.service
systemctl list-timers scada-certbot.timer scada-backup.timer --no-pager
