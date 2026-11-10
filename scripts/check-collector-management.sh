#!/bin/sh
set -eu
scada exec -T backend node <<'JS'
const mysql=require('mysql2/promise'),crypto=require('node:crypto'),assert=require('node:assert/strict');
(async()=>{
const db=await mysql.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
const base='http://127.0.0.1:3001/api';
let cookie,cid,sid,gid;
async function call(path,method='GET',body,token,session=cookie){
 const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(session?{Cookie:session}:{}),...(token?{'X-Collector-Key':token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
try{
 const login=await call('/auth/login','POST',{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD});assert.equal(login.status,200);cookie=login.cookie;
 const baseline=(await call('/communication-status')).data;
 const suffix=crypto.randomBytes(8).toString('hex');
 const added=await call('/admin/collectors','POST',{name:'Management test '+suffix});assert.equal(added.status,201);cid=added.data.id;const token=added.data.token;
 assert.equal((await call('/admin/collectors/'+cid,'DELETE',null,null,null)).status,401);
 const disabled=await call('/admin/collectors/'+cid,'PATCH',{enabled:false,baud_rate:115200});assert.equal(disabled.status,200);
 const status=(await call('/communication-status')).data;
 assert.equal(status.total,baseline.total);assert.equal(status.disabled,baseline.disabled+1);assert.equal(status.unavailable,baseline.unavailable);
 assert.equal((await call('/admin/collectors/'+cid,'PATCH',{enabled:true,baud_rate:115200})).status,200);
 const sync=await call('/collector/v1/sync','POST',{devices:[{device_id:'test_esp',channel:'current_1',name:'Test ESP',port:'/dev/test',last_seen:new Date().toISOString()}],ports:['/dev/test'],queued:0,version:'test'},token);assert.equal(sync.status,200);
 const [g]=await db.execute('INSERT INTO sensor_groups(name) VALUES (?)',['Temporary management test '+suffix]);gid=g.insertId;
 const [s]=await db.execute('INSERT INTO sensors(group_id,sensor_key,name,kind,unit,min_value,max_value) VALUES (?,?,?,?,?,?,?)',[gid,'management_'+suffix,'Temporary management test','custom','mA',4,20]);sid=s.insertId;
 await db.execute('INSERT INTO sensor_samples(sensor_id,value) VALUES (?,12)',[sid]);
 assert.equal((await call('/admin/collectors/'+cid+'/channel','PUT',{device_id:'test_esp',channel:'current_1',sensor_id:sid,input_min:4,input_max:20})).status,200);
 assert.equal((await call('/admin/collectors/'+cid,'DELETE')).status,200);
 assert.equal((await call('/admin/collectors/'+cid,'DELETE')).status,404);
 assert.equal((await call('/collector/v1/sync','POST',{devices:[],ports:[],queued:0},token)).status,401);
 for(const table of ['collectors','collector_devices','collector_channels','collector_records']){
  const [[r]]=await db.execute('SELECT COUNT(*) n FROM '+table+' WHERE '+(table==='collectors'?'id':'collector_id')+'=?',[cid]);assert.equal(r.n,0);
 }
 const [[history]]=await db.execute('SELECT COUNT(*) n FROM sensor_samples WHERE sensor_id=?',[sid]);assert.equal(history.n,1);
 console.log('PASS: disabled gateway ignored; anonymous deletion blocked; deletion revokes key and removes links; measurement history retained; repeated deletion returns 404');
}finally{
 if(cid){for(const table of ['collector_records','collector_channels','collector_devices'])await db.execute('DELETE FROM '+table+' WHERE collector_id=?',[cid]);await db.execute('DELETE FROM collectors WHERE id=?',[cid]);}
 if(sid){await db.execute('DELETE FROM sensor_samples WHERE sensor_id=?',[sid]);await db.execute('DELETE FROM sensors WHERE id=?',[sid]);}
 if(gid)await db.execute('DELETE FROM sensor_groups WHERE id=?',[gid]);
 if(cookie)await call('/auth/logout','POST',{});
 await db.end();
}
})().catch(e=>{console.error(e.message);process.exit(1)});
JS
