#!/bin/sh
# Retry safely until the owner's DNS record points at this server.
set -eu
umask 077
cd /opt/tech-scada
domain=xn--80aaap2aq3a9c.xn--p1ai
exec 9>/run/scada-domain.lock
flock -n 9 || exit 0
[ ! -f .domain-active ] || exit 0
if ! python3 - <<'PY'
import socket, sys
try:
    addresses = {item[4][0] for item in socket.getaddrinfo('xn--80aaap2aq3a9c.xn--p1ai', 443, type=socket.SOCK_STREAM)}
except OSError:
    sys.exit(1)
sys.exit(0 if addresses == {'170.168.150.194'} else 1)
PY
then
  echo 'Waiting for domain DNS to point exclusively at 170.168.150.194'
  exit 0
fi
/opt/certbot/bin/certbot certonly --webroot --webroot-path /var/www/acme --cert-name "$domain" -d "$domain" --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring
if [ ! -f deploy/nginx-ip-before-domain.conf ]; then
  cp -p deploy/nginx-ip.conf deploy/nginx-ip-before-domain.conf
fi
python3 - <<'PY'
from pathlib import Path
domain = 'xn--80aaap2aq3a9c.xn--p1ai'
original = Path('deploy/nginx-ip-before-domain.conf').read_text()
# Keep the inode: this file is mounted individually in the nginx container.
Path('deploy/nginx-ip.conf').write_text(original+'\n'+original.replace('170.168.150.194',domain))
env = Path('.env.local')
lines = [line for line in env.read_text().splitlines() if not line.startswith('APP_URL=')]
env.write_text('\n'.join(lines)+f'\nAPP_URL=https://{domain}\n')
PY
scada up -d --no-build --no-deps --wait --wait-timeout 240 backend
scada exec -T frontend nginx -t
scada exec -T frontend nginx -s reload
curl --fail --silent --show-error --max-time 30 "https://$domain/api/health"
touch .domain-active
systemctl disable --now scada-domain.timer
echo 'Domain activated: https://нашскада.рф'
