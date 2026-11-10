#!/bin/sh
set -eu
cd /opt/tech-scada
backup=/var/backups/tech-scada/communication-before-$(date +%Y%m%d-%H%M%S)
install -d -m 700 "$backup"
docker cp tech-scada-backend-1:/app/server.js "$backup/server.js"
docker cp tech-scada-backend-1:/app/collectors.js "$backup/collectors.js"
docker cp tech-scada-backend-1:/app/communication.js "$backup/communication.js"
docker tag tech-scada-backend:deploy tech-scada-backend:before-communication
cat > /opt/tech-scada/deploy/backend-communication.Dockerfile <<'EOF'
FROM tech-scada-backend:before-communication
COPY server.js communication.js collectors.js ./
EOF
docker build -t tech-scada-backend:deploy -f deploy/backend-communication.Dockerfile backend
scada up -d --no-deps backend
for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if scada exec -T backend node -e 'fetch("http://127.0.0.1:3001/api/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'; then break; fi
    sleep 2
done
