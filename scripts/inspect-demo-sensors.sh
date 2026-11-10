#!/bin/sh
set -eu
scada exec -T backend node <<'JS'
const mysql=require('mysql2/promise');
(async()=>{
const db=await mysql.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
for(const [label,sql] of Object.entries({sensors:'SELECT s.id,s.sensor_key,s.name,s.group_id,c.collector_id,(SELECT COUNT(*) FROM sensor_samples p WHERE p.sensor_id=s.id) samples FROM sensors s LEFT JOIN collector_channels c ON c.sensor_id=s.id',groups:'SELECT * FROM sensor_groups',collectors:'SELECT id,name,last_seen FROM collectors',migrations:'SELECT * FROM telemetry_migrations',legacy:'SELECT COUNT(*) n FROM readings'})){
const [rows]=await db.query(sql);console.log(JSON.stringify({[label]:rows}));}
await db.end();})().catch(e=>{console.error(e.message);process.exit(1)});
JS
