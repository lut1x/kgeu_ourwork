#!/bin/sh
set -eu
/usr/local/bin/scada exec -T backend node <<'JS'
const mysql=require('mysql2/promise');
(async()=>{
 const db=await mysql.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
 const [rows]=await db.execute('SELECT id,name,enabled,last_seen,TIMESTAMPDIFF(SECOND,last_seen,UTC_TIMESTAMP()) AS seconds_since_seen,status_json FROM collectors ORDER BY id');
 console.log(JSON.stringify({collectors:rows}));
 const [[count]]=await db.query("SELECT COUNT(*) n FROM sensor_groups WHERE name LIKE 'Installation self-test %'");
 if(count.n)throw Error('Temporary test groups remain');
 await db.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
JS
systemctl is-active docker scada-stack scada-recover.timer scada-backup.timer
systemctl --failed --no-pager
curl -fsS --max-time 15 https://scada.lut1x1337.ru:9443/api/health
echo
