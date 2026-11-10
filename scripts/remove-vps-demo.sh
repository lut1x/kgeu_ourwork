#!/bin/sh
set -eu
cd /opt/tech-scada
backup=/var/backups/tech-scada/demo-removal-$(date +%Y%m%d-%H%M%S)
install -d -m 700 "$backup"
cp docker-compose.server.yml docker-compose.small-server.yml "$backup/"
tar -czf "$backup/simulator-source.tar.gz" simulator
systemctl start scada-backup.service
# Stop the generator before touching its data. Removing its container prevents
# Docker's restart policy from bringing it back independently of Compose.
if docker container inspect tech-scada-simulator-1 >/dev/null 2>&1; then
    docker stop tech-scada-simulator-1
    docker rm tech-scada-simulator-1
fi
scada exec -T backend node <<'JS'
const mysql=require('mysql2/promise');
(async()=>{
const db=await mysql.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
try{
await db.beginTransaction();
const keys=['temp_01','fan_01','voltage_01','temp_02','pressure_01','flow_01'];
const [rows]=await db.execute('SELECT s.id,c.collector_id FROM sensors s LEFT JOIN collector_channels c ON c.sensor_id=s.id WHERE s.sensor_key IN (?,?,?,?,?,?) FOR UPDATE',keys);
if(rows.some(r=>r.collector_id!==null))throw Error('Demo key is mapped to real hardware; refusing deletion');
let deleted=0;
for(const row of rows){
 const [r]=await db.execute('DELETE FROM sensor_samples WHERE sensor_id=?',[row.id]);deleted+=r.affectedRows;
 await db.execute('DELETE FROM sensors WHERE id=?',[row.id]);
}
// This legacy table predates real collectors and contains the original demo.
const [legacy]=await db.execute('DELETE FROM readings');
for(const [id,name] of [[1,'Контур охлаждения'],[2,'Производственная линия']]){
await db.execute('DELETE FROM sensor_groups WHERE id=? AND name=? AND NOT EXISTS (SELECT 1 FROM sensors WHERE group_id=?)',[id,name,id]);
}
// Keep migration markers: the old startup migration must not reseed the demo.
await db.commit();
console.log(JSON.stringify({removed_demo_sensors:rows.length,removed_samples:deleted,removed_legacy_samples:legacy.affectedRows}));
}catch(e){await db.rollback();throw e;}finally{await db.end();}
})().catch(e=>{console.error(e.message);process.exit(1)});
JS
printf 'Backup: %s\n' "$backup"
