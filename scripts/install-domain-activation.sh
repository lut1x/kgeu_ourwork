#!/bin/sh
set -eu
install -m 700 /opt/tech-scada/activate-domain.sh /usr/local/sbin/scada-activate-domain
cat > /etc/systemd/system/scada-domain.service <<'EOF'
[Unit]
Description=Activate SCADA domain after DNS is ready
After=network-online.target docker.service
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/scada-activate-domain
TimeoutStartSec=600
EOF
cat > /etc/systemd/system/scada-domain.timer <<'EOF'
[Unit]
Description=Check SCADA domain DNS every five minutes until activation
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
EOF
systemd-analyze verify /etc/systemd/system/scada-domain.service /etc/systemd/system/scada-domain.timer
systemctl daemon-reload
systemctl enable --now scada-domain.timer
systemctl start scada-domain.service
systemctl status scada-domain.service scada-domain.timer --no-pager || test "$(systemctl is-active scada-domain.timer)" = active
