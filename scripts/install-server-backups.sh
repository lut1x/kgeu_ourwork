#!/bin/sh
set -eu
umask 077
install -d -m 700 /var/backups/tech-scada
cat > /usr/local/sbin/scada-backup <<'EOF'
#!/bin/sh
set -eu
umask 077
backup_dir=/var/backups/tech-scada
stamp=$(date +%Y%m%d-%H%M%S)
install -d -m 700 "$backup_dir"
sql_file="$backup_dir/database-$stamp.sql"
/usr/local/bin/scada exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --no-tablespaces --set-gtid-purged=OFF techmonitor' > "$sql_file.partial"
mv "$sql_file.partial" "$sql_file"
gzip "$sql_file"
gzip -t "$sql_file.gz"
install -m 600 /opt/tech-scada/.env.local "$backup_dir/environment-$stamp.env"
find "$backup_dir" -maxdepth 1 -type f \( -name 'database-*.sql.gz' -o -name 'environment-*.env' \) -mtime +7 -delete
printf 'SCADA backup completed: %s\n' "$stamp"
EOF
chmod 700 /usr/local/sbin/scada-backup
cat > /etc/systemd/system/scada-backup.service <<'EOF'
[Unit]
Description=SCADA database and encryption key backup
Requires=docker.service
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/scada-backup
Nice=10
IOSchedulingClass=idle
EOF
cat > /etc/systemd/system/scada-backup.timer <<'EOF'
[Unit]
Description=Daily SCADA backup
[Timer]
OnCalendar=*-*-* 03:30:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now scada-backup.timer
systemctl start scada-backup.service
RENEWED_LINEAGE=/etc/letsencrypt/live/scada.lut1x1337.ru /etc/letsencrypt/renewal-hooks/deploy/scada-reload
systemctl list-timers scada-backup.timer certbot.timer
