#!/bin/sh
set -eu
umask 077
cd /opt/tech-scada
install -d -m 755 /var/www/acme
cat > /usr/local/bin/scada <<'EOF'
#!/bin/sh
cd /opt/tech-scada
exec docker compose --env-file .env.local -f docker-compose.ip.yml "$@"
EOF
chmod 755 /usr/local/bin/scada
scada config --quiet
DOCKER_BUILDKIT=0 scada build backend
scada up -d --no-build --wait --wait-timeout 600
if [ ! -f .initial-install-complete ]; then
  scada exec -T backend node <<'JS'
const mysql=require('mysql2/promise');
(async()=>{
 const db=await mysql.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectTimeout:60000});
 const [[{n}]]=await db.query('SELECT COUNT(*) n FROM users');
 const [[{s}]]=await db.query('SELECT COUNT(*) s FROM sensor_samples');
 if(n || s)throw Error('Refusing initial cleanup of nonempty database');
 await db.query('DELETE FROM sensors');
 await db.query('DELETE FROM sensor_groups');
 await db.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
JS
  scada exec -T backend node create-admin.js
  touch .initial-install-complete
fi
scada exec -T backend node smtp-check.js
scada ps
df -h /
docker stats --no-stream
