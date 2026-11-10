#!/bin/sh
set -eu
umask 077
install -d -m 700 /opt/tech-scada /var/backups/tech-scada
if [ ! -e /swap-scada ]; then
  fallocate -l 1G /swap-scada
  chmod 600 /swap-scada
  mkswap /swap-scada
  swapon /swap-scada
  printf '\n/swap-scada none swap sw 0 0\n' >> /etc/fstab
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends docker.io docker-cli docker-compose ca-certificates curl python3-venv
systemctl enable --now docker
python3 -m venv /opt/certbot
/opt/certbot/bin/pip install --no-cache-dir certbot
docker --version
docker compose version
df -h /
