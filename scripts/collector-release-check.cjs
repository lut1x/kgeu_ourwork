// Copy to /app inside the backend container. Creates only temporary release-check data.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const base = 'https://scada.lut1x1337.ru:9443/api';
async function main() {
  const conn = await mysql.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,timezone:'Z'});
  let cookie,collectorId,sensorId,groupId;
  async function call(endpoint,method='GET',body,token) {
    const r=await fetch(base+endpoint,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(token?{'X-Collector-Key':token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
    const data=await r.json(); if(r.status>=400) throw new Error(`API ${endpoint}: ${r.status}`);
    return {data,status:r.status,cookie:r.headers.get('set-cookie')?.split(';')[0]};
  }
  try {
    assert.equal((await call('/health')).status,200);
    const login=await call('/auth/login','POST',{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD});cookie=login.cookie;assert.ok(cookie);
    const suffix=crypto.randomBytes(6).toString('hex');
    const group=await call('/admin/groups','POST',{name:'Release check '+suffix});groupId=group.data.id;
    const sensor=await call('/admin/sensors','POST',{group_id:groupId,sensor_key:'release_'+suffix,name:'Release check',kind:'pressure',unit:'bar',min_value:0,max_value:10,warning_value:null,critical_value:null});sensorId=sensor.data.id;
    const collector=await call('/admin/collectors','POST',{name:'Release check '+suffix});collectorId=collector.data.id;const token=collector.data.token;
    const status={devices:[{device_id:'release_esp',channel:'current_1',name:'Release ESP',port:'/dev/ttyUSB0',last_seen:new Date().toISOString()}],ports:['/dev/ttyUSB0'],queued:1,version:'release-check'};
    await call('/collector/v1/sync','POST',status,token);
    await call(`/admin/collectors/${collectorId}/channel`,'PUT',{device_id:'release_esp',channel:'current_1',sensor_id:sensorId,input_min:4,input_max:20});
    const config=await call('/collector/v1/sync','POST',status,token);assert.equal(config.data.channels.length,1);
    const record={record_id:crypto.randomUUID(),device_id:'release_esp',channel:'current_1',value:12,observed_at:new Date(Date.now()-60000).toISOString()};
    const batch={records:[record]};
    assert.deepEqual((await call('/collector/v1/batches','POST',batch,token)).data.ack,[record.record_id]);
    await call('/collector/v1/batches','POST',batch,token);
    const [[stored]]=await conn.execute('SELECT COUNT(*) n,MAX(value) value,MAX(created_at) observed FROM sensor_samples WHERE sensor_id=?',[sensorId]);
    assert.equal(stored.n,1);assert.equal(stored.value,5);assert.equal(stored.observed.toISOString(),record.observed_at);
    const catalog=await call('/catalog');assert.equal(catalog.data.sensors.find(s=>s.id===sensorId).value,5);
    const collectors=await call('/admin/collectors');assert.ok(collectors.data.devices.some(d=>d.collector_id===collectorId&&d.sensor_id===sensorId));
    console.log('PASS: public HTTPS, admin session, ESP32 discovery, remote channel config, 4–20mA scaling, original timestamp, deduplication and catalog');
  } finally {
    if(collectorId){for(const table of ['collector_records','collector_channels','collector_devices'])await conn.execute(`DELETE FROM ${table} WHERE collector_id=?`,[collectorId]);await conn.execute('DELETE FROM collectors WHERE id=?',[collectorId]);}
    if(sensorId){await conn.execute('DELETE FROM sensor_samples WHERE sensor_id=?',[sensorId]);await conn.execute('DELETE FROM sensors WHERE id=?',[sensorId]);}
    if(groupId)await conn.execute('DELETE FROM sensor_groups WHERE id=?',[groupId]);
    if(cookie)await call('/auth/logout','POST',{});
    await conn.end();console.log('Temporary release-check data removed');
  }
}
main().catch(e=>{console.error('Release check failed:',e.message);process.exitCode=1;});
