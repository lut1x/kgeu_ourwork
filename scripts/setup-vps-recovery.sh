#!/bin/sh
set -eu
cd /opt/tech-scada
backup=/var/backups/tech-scada/recovery-before-$(date +%Y%m%d-%H%M%S)
install -d -m 700 "$backup"
cp -a docker-compose.server.yml docker-compose.small-server.yml "$backup/"
install -m 755 deploy/scada-recover.sh /usr/local/sbin/scada-recover
install -m 644 deploy/scada-recover.service deploy/scada-recover.timer deploy/scada-stack.service /etc/systemd/system/
sh -n /usr/local/sbin/scada-recover
systemd-analyze verify /etc/systemd/system/scada-recover.service /etc/systemd/system/scada-recover.timer /etc/systemd/system/scada-stack.service
systemctl daemon-reload
systemctl enable docker scada-stack.service
systemctl enable --now scada-recover.timer
systemctl start scada-recover.service
systemctl start scada-backup.service
systemctl is-enabled docker scada-stack.service scada-backup.timer scada-recover.timer
journalctl -u scada-recover.service -u scada-backup.service -n 10 --no-pager
