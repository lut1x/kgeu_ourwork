#!/bin/sh
# Authorized deployment fault test: freeze only the SCADA API process.
set -eu
trap 'docker kill --signal=CONT tech-scada-backend-1 >/dev/null 2>&1 || true' EXIT
before=$(docker inspect -f '{{.State.StartedAt}}' tech-scada-backend-1)
docker kill --signal=STOP tech-scada-backend-1
for attempt in 1 2 3; do
    systemctl start scada-recover.service
done
after=$(docker inspect -f '{{.State.StartedAt}}' tech-scada-backend-1)
[ "$before" != "$after" ] || { echo 'Backend did not restart'; exit 1; }
for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if curl --fail --silent --max-time 5 https://scada.lut1x1337.ru:9443/api/health; then
        echo
        echo 'Frozen VPS backend recovered automatically after failed probes'
        journalctl -u scada-recover.service -n 15 --no-pager
        exit 0
    fi
    sleep 2
done
echo 'API did not recover in time'
exit 1
