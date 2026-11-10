#!/bin/sh
set -eu
export DEBIAN_FRONTEND=noninteractive
backup=/root/scada-setup-backups/$(date +%Y%m%d-%H%M%S)
install -d -m 700 "$backup"
cp -a /boot/firmware/config.txt /boot/firmware/cmdline.txt /boot/dietpi.txt "$backup/"
if ! python3 -c 'import serial, sqlite3' 2>/dev/null || [ ! -x /usr/lib/openssh/sftp-server ] || [ ! -x /usr/bin/dbus-daemon ]; then
    apt-get update
    apt-get install -y python3 python3-serial ca-certificates curl sqlite3 dbus openssh-sftp-server
fi

# DietPi mode 4 keeps timesyncd running instead of stopping it after first sync.
sed -i 's/^CONFIG_NTP_MODE=.*/CONFIG_NTP_MODE=4/' /boot/dietpi.txt
ln -snf /usr/share/zoneinfo/Europe/Moscow /etc/localtime
printf 'Europe/Moscow\n' > /etc/timezone
install -d /etc/systemd/timesyncd.conf.d
printf '[Time]\nNTP=0.debian.pool.ntp.org 1.debian.pool.ntp.org\nFallbackNTP=time.cloudflare.com\n' > /etc/systemd/timesyncd.conf.d/scada.conf
systemctl enable --now dbus systemd-timesyncd

# Free the physical UART; keep console=tty1 and SSH.
sed -i -E 's/(^| )console=(ttyAMA0|serial0|ttyS0),[0-9]+//g' /boot/firmware/cmdline.txt
systemctl mask --now serial-getty@ttyAMA0.service serial-getty@serial0.service serial-getty@ttyS0.service
grep -q '^enable_uart=1$' /boot/firmware/config.txt || printf '\nenable_uart=1\n' >> /boot/firmware/config.txt
grep -q '^dtparam=watchdog=on$' /boot/firmware/config.txt || printf '\ndtparam=watchdog=on\n' >> /boot/firmware/config.txt

# Pi 2 hardware supports a maximum watchdog timeout near 15 seconds.
install -d /etc/systemd/system.conf.d
printf '[Manager]\nRuntimeWatchdogSec=15s\nRebootWatchdogSec=10min\n' > /etc/systemd/system.conf.d/scada-watchdog.conf

# Journald is bounded and volatile; DietPi's ramlog persists /var/log separately.
install -d /etc/systemd/journald.conf.d
printf '[Journal]\nStorage=volatile\nRuntimeMaxUse=16M\nRuntimeKeepFree=32M\nMaxRetentionSec=7day\n' > /etc/systemd/journald.conf.d/scada.conf
systemctl restart systemd-journald

id scada-gateway >/dev/null 2>&1 || useradd --system --home /var/lib/scada-gateway --shell /usr/sbin/nologin --groups dialout scada-gateway
install -d -m 755 /opt/scada-gateway
install -d -m 700 /etc/scada-gateway
install -d -o scada-gateway -g scada-gateway -m 700 /var/lib/scada-gateway
install -m 644 /root/scada-install/gateway.py /opt/scada-gateway/gateway.py
install -m 644 /root/scada-install/scada-gateway.service /etc/systemd/system/scada-gateway.service
install -m 600 /root/scada-install/gateway.env /etc/scada-gateway/gateway.env
install -m 755 /root/scada-install/backup.py /opt/scada-gateway/backup.py
install -m 644 /root/scada-install/scada-gateway-backup.service /root/scada-install/scada-gateway-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now scada-gateway
for attempt in 1 2 3 4 5 6 7 8 9 10; do
    [ ! -f /var/lib/scada-gateway/queue.sqlite ] || break
    sleep 1
done
systemctl enable --now scada-gateway-backup.timer
systemctl start scada-gateway-backup.service
python3 --version
systemctl status scada-gateway --no-pager
printf 'Configuration backup: %s\n' "$backup"
