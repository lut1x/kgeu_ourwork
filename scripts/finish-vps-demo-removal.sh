#!/bin/sh
set -eu
cd /opt/tech-scada
scada config --quiet
services=$(scada config --services)
printf '%s\n' "$services"
if printf '%s\n' "$services" | grep -qx simulator; then
    echo 'Simulator still present in production configuration'; exit 1
fi
# The source was archived by remove-vps-demo.sh before deletion.
if [ -d /opt/tech-scada/simulator ]; then
    [ "$(realpath /opt/tech-scada/simulator)" = /opt/tech-scada/simulator ]
    rm -rf -- /opt/tech-scada/simulator
fi
if docker image inspect tech-scada-simulator:deploy >/dev/null 2>&1; then
    docker image rm tech-scada-simulator:deploy
fi
# Reconnect browsers so their cached catalog refreshes. Also proves the startup
# migration does not recreate the removed demonstration sensors.
scada restart backend
for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS --max-time 5 https://scada.lut1x1337.ru:9443/api/health; then break; fi
    sleep 2
done
echo
curl -fsS --max-time 10 https://scada.lut1x1337.ru:9443/api/health
echo
systemctl start scada-recover.service
scada ps
