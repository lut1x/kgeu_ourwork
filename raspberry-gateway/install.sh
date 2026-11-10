#!/bin/sh
set -eu
if [ "$(id -u)" -ne 0 ]; then echo 'Run: sudo sh install.sh'; exit 1; fi
cd "$(dirname "$0")"
apt-get update
apt-get install -y python3 python3-serial ca-certificates
id scada-gateway >/dev/null 2>&1 || useradd --system --home /var/lib/scada-gateway --shell /usr/sbin/nologin --groups dialout scada-gateway
install -d -m 755 /opt/scada-gateway
install -d -m 700 /etc/scada-gateway
install -d -o scada-gateway -g scada-gateway -m 700 /var/lib/scada-gateway
install -m 644 gateway.py /opt/scada-gateway/gateway.py
install -m 755 backup.py /opt/scada-gateway/backup.py
if [ ! -f /etc/scada-gateway/gateway.env ]; then
  printf 'SCADA URL [https://scada.lut1x1337.ru:9443]: '
  read -r url
  url=${url:-https://scada.lut1x1337.ru:9443}
  case "$url" in https://*) ;; *) echo 'HTTPS required'; exit 1;; esac
  printf 'Collector key from SCADA: '
  stty -echo
  trap 'stty echo' EXIT
  read -r key
  stty echo
  trap - EXIT
  printf '\n'
  [ "${#key}" -eq 64 ] || { echo 'Key must contain 64 hex characters'; exit 1; }
  case "$key" in *[!a-f0-9]*) echo 'Invalid key'; exit 1;; esac
  case "$url" in *[!a-zA-Z0-9:/._-]*) echo 'Invalid URL'; exit 1;; esac
  umask 077
  printf 'SCADA_URL=%s\nCOLLECTOR_KEY=%s\nUART_PORTS=/dev/serial0\n' "$url" "$key" > /etc/scada-gateway/gateway.env
fi
install -m 644 scada-gateway.service /etc/systemd/system/scada-gateway.service
install -m 644 scada-gateway-backup.service scada-gateway-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable scada-gateway.service
systemctl restart scada-gateway.service
systemctl enable --now scada-gateway-backup.timer
echo 'Installed. Manage channels in SCADA: Платы и устройства.'
echo 'Logs: sudo journalctl -u scada-gateway -f'
