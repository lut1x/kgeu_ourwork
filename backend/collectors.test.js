const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const mysql = require('mysql2/promise');
const { validateRecord } = require('./collectors');
const env = {};
for (const line of fs.readFileSync(process.env.TEST_ENV_FILE || require('node:path').join(__dirname,'../.env.local'),'utf8').split(/\r?\n/)) {
  const m=line.match(/^([A-Z_]+)=(.*)$/); if(m) env[m[1]]=m[2];
}
test('collector validation rejects nonfinite and invalid timestamps',()=>{
  const r={record_id:crypto.randomUUID(),device_id:'esp_1',channel:'current_1',value:12,observed_at:new Date().toISOString()};
  assert.ok(validateRecord(r));
  for(const value of [NaN,Infinity,'12',true]) assert.ok(!validateRecord({...r,value}));
  assert.ok(!validateRecord({...r,observed_at:'garbage'}));
  assert.ok(!validateRecord({...r,observed_at:'2000-01-01T00:00:00Z'}));
});
test('collector enrollment, scope, scaling, original time, retry, state and token revocation',async t=>{
  const conn=await mysql.createConnection({host:'127.0.0.1',port:3307,user:'root',password:'techmonitor',database:'techmonitor',timezone:'Z'});
  let cookie,collectorId,sensorId,groupId;
  async function call(endpoint,method='GET',body,token,session=cookie){
    const r=await fetch('http://localhost/api'+endpoint,{method,headers:{'Content-Type':'application/json',...(session?{Cookie:session}:{}),...(token?{'X-Collector-Key':token}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
  }
  t.after(async()=>{
    if(collectorId){ for(const table of ['collector_records','collector_channels','collector_devices']) await conn.execute(`DELETE FROM ${table} WHERE collector_id=?`,[collectorId]); await conn.execute('DELETE FROM collectors WHERE id=?',[collectorId]); }
    if(sensorId){await conn.execute('DELETE FROM sensor_samples WHERE sensor_id=?',[sensorId]);await conn.execute('DELETE FROM sensors WHERE id=?',[sensorId]);}
    if(groupId) await conn.execute('DELETE FROM sensor_groups WHERE id=?',[groupId]);
    if(cookie) await call('/auth/logout','POST',{});
    await conn.end();
  });
  assert.equal((await call('/admin/collectors','GET',null,null,null)).status,401);
  const login=await call('/auth/login','POST',{email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD});assert.equal(login.status,200);cookie=login.cookie;
  const suffix=crypto.randomBytes(6).toString('hex');
  const group=await call('/admin/groups','POST',{name:'Gateway test '+suffix});assert.equal(group.status,201);groupId=group.data.id;
  const sensor=await call('/admin/sensors','POST',{group_id:groupId,sensor_key:'gw_'+suffix,name:'Pressure test',kind:'pressure',unit:'bar',min_value:0,max_value:10,warning_value:null,critical_value:null});assert.equal(sensor.status,201);sensorId=sensor.data.id;
  const collector=await call('/admin/collectors','POST',{name:'Test '+suffix});assert.equal(collector.status,201);collectorId=collector.data.id;const token=collector.data.token;
  const status={version:'test',queued:0,ports:['/dev/ttyUSB0'],devices:[{device_id:'esp_1',channel:'current_1',name:'Test ESP',port:'/dev/ttyUSB0',last_seen:new Date().toISOString()}]};
  assert.equal((await call('/collector/v1/sync','POST',status,'a'.repeat(64))).status,401);
  assert.equal((await call('/collector/v1/sync','POST',status,token)).status,200);
  assert.equal((await call(`/admin/collectors/${collectorId}/channel`,'PUT',{device_id:'esp_1',channel:'current_1',sensor_id:sensorId,input_min:4,input_max:20})).status,200);
  const config=await call('/collector/v1/sync','POST',status,token); assert.deepEqual(config.data.channels,[{device_id:'esp_1',channel:'current_1'}]);
  const record={record_id:crypto.randomUUID(),device_id:'esp_1',channel:'current_1',value:12,observed_at:new Date(Date.now()-60000).toISOString()};
  const batch={records:[record]}; const first=await call('/collector/v1/batches','POST',batch,token);assert.equal(first.status,201);assert.deepEqual(first.data.ack,[record.record_id]);
  assert.equal((await call('/collector/v1/batches','POST',batch,token)).status,201);
  const [[count]]=await conn.execute('SELECT COUNT(*) n FROM sensor_samples WHERE sensor_id=?',[sensorId]);assert.equal(count.n,1);
  const [[sample]]=await conn.execute('SELECT value,created_at FROM sensor_samples WHERE sensor_id=?',[sensorId]);assert.equal(sample.value,5);assert.equal(sample.created_at.toISOString(),record.observed_at);
  assert.equal((await call('/collector/v1/batches','POST',{records:[{...record,value:15}]},token)).status,409);
  const foreign={...record,record_id:crypto.randomUUID(),device_id:'other'};const rejected=await call('/collector/v1/batches','POST',{records:[foreign]},token);assert.equal(rejected.data.rejected.length,1);assert.equal(rejected.data.ack.length,0);
  // Delayed historical upload must never replace the current reading in the catalog.
  await call('/collector/v1/batches','POST',{records:[{...record,record_id:crypto.randomUUID(),value:4,observed_at:new Date(Date.now()-3600000).toISOString()}]},token);
  const catalog=await call('/catalog');assert.equal(catalog.data.sensors.find(s=>s.id===sensorId).value,5);
  assert.equal((await call(`/admin/collectors/${collectorId}`,'PATCH',{enabled:false,baud_rate:115200})).status,200);
  assert.equal((await call('/collector/v1/sync','POST',status,token)).status,401);
  await call(`/admin/collectors/${collectorId}`,'PATCH',{enabled:true,baud_rate:9600});
  assert.equal((await call('/collector/v1/sync','POST',status,token)).data.baud_rate,9600);
  const rotated=await call(`/admin/collectors/${collectorId}/token`,'POST',{});assert.equal(rotated.status,200);
  assert.equal((await call('/collector/v1/sync','POST',status,token)).status,401);
  assert.equal((await call('/collector/v1/sync','POST',status,rotated.data.token)).status,200);
});
