#!/bin/sh
# Local probes only: a WAN/DNS outage must not trigger container restarts.
set -eu
[ ! -e /etc/scada-maintenance ] || exit 0
state=/run/scada-recovery
install -d -m 700 "$state"
exec 9>"$state/lock"
flock -n 9 || exit 0

recover() {
    service=$1
    count=0
    [ ! -f "$state/$service.failures" ] || read -r count < "$state/$service.failures"
    count=$((count+1))
    printf '%s\n' "$count" > "$state/$service.failures"
    echo "$service probe failed ($count/3)"
    [ "$count" -ge 3 ] || return 0
    now=$(date +%s)
    last=0
    [ ! -f "$state/$service.restarted" ] || read -r last < "$state/$service.restarted"
    [ "$((now-last))" -ge 300 ] || return 0
    printf '%s\n' "$now" > "$state/$service.restarted"
    /usr/local/bin/scada up -d --no-build "$service"
    /usr/local/bin/scada restart "$service"
    printf '0\n' > "$state/$service.failures"
    echo "$service restarted after repeated local probe failures"
}
healthy() { printf '0\n' > "$state/$1.failures"; }

if ! timeout 15 /usr/local/bin/scada exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=TCP -h127.0.0.1 -uroot -Nse "SELECT 1"' >/dev/null 2>&1; then
    recover mysql
    exit 0
fi
healthy mysql
if ! timeout 12 /usr/local/bin/scada exec -T backend node -e 'fetch("http://127.0.0.1:3001/api/health",{signal:AbortSignal.timeout(7000)}).then(async r=>{if(!r.ok||(await r.json()).status!=="ok")process.exit(1)}).catch(()=>process.exit(1))' >/dev/null 2>&1; then
    recover backend
    exit 0
fi
healthy backend
# Verify reverse proxy routing and certificate locally, independently of WAN DNS.
if ! curl --fail --silent --show-error --max-time 10 --connect-to scada.lut1x1337.ru:9443:127.0.0.1:9443 https://scada.lut1x1337.ru:9443/api/health >/dev/null 2>&1; then
    recover frontend
    exit 0
fi
healthy frontend
