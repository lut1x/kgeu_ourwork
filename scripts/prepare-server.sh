#!/bin/sh
set -eu
umask 077
backup_dir="/root/scada-deployment-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
tar -czf "$backup_dir/x-ui-config.tar.gz" /etc/x-ui /etc/systemd/system/x-ui.service /usr/local/x-ui/bin/config.json 2>"$backup_dir/backup-notes.log" || {
  tar -czf "$backup_dir/x-ui-config.tar.gz" /etc/x-ui /etc/systemd/system/x-ui.service
}
iptables-save > "$backup_dir/iptables.rules"
ip6tables-save > "$backup_dir/ip6tables.rules"
nft list ruleset > "$backup_dir/nft.rules"
cp /etc/fstab "$backup_dir/fstab"
ss -lntp > "$backup_dir/listeners-before.txt"
if [ ! -e /swap-scada ]; then
  fallocate -l 2G /swap-scada
  chmod 600 /swap-scada
  mkswap /swap-scada
  swapon /swap-scada
  grep -q '^/swap-scada ' /etc/fstab || printf '\n/swap-scada none swap sw 0 0\n' >> /etc/fstab
fi
apt-get update -qq
apt-get install -y ca-certificates curl openssl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: trixie
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update -qq
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
systemctl is-active x-ui
ss -lntp | grep -E ':(443|8443)\b'
printf 'Configuration backup: %s\n' "$backup_dir"
