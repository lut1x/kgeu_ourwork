const test = require('node:test');
const assert = require('node:assert/strict');
const { communicationStatus, installCommunicationStatus } = require('./communication');
const now = Date.parse('2026-10-16T20:00:00Z');
const board = (age = 1000, extra = {}) => ({ enabled: 1, last_seen: new Date(now-age), status_json: {}, ...extra });
test('active requires every registered board online; no boards is not active', () => {
  assert.equal(communicationStatus([],now).state,'empty');
  assert.equal(communicationStatus([board(),board(59000)],now).state,'active');
  for (const offline of [board(60000),board(61000),board(0,{last_seen:null}),board(-1000)]) {
    const status=communicationStatus([board(),offline],now);
    assert.equal(status.state,'error'); assert.equal(status.unavailable,1); assert.equal(status.online,1);
  }
  assert.equal(communicationStatus([board(0,{status_json:{error:'Queue full'}})],now).state,'error');
});
test('manually disabled gateways are excluded, even if stale or reporting errors',()=>{
  const disabled=board(90000,{enabled:0,status_json:{error:'old error'}});
  const result=communicationStatus([board(),disabled],now);
  assert.equal(result.state,'active'); assert.equal(result.total,1); assert.equal(result.disabled,1);
  assert.equal(result.unavailable,0); assert.equal(result.errors,0);
  assert.equal(communicationStatus([disabled],now).state,'disabled');
});
test('status recovers after heartbeat resumes',()=>{
  const c=board(65000);
  assert.equal(communicationStatus([c],now).state,'error');
  c.last_seen=new Date(now);
  assert.equal(communicationStatus([c],now).state,'active');
});
test('aggregate route requires login, avoids caching and propagates DB failure',async()=>{
  let route;
  const auth=()=>{};
  installCommunicationStatus({get:(...args)=>route=args},{execute:async()=>[[board()]]},auth);
  assert.equal(route[0],'/api/communication-status'); assert.equal(route[1],auth);
  let header,payload;
  await route[2]({}, {set:(...v)=>header=v,json:v=>payload=v}, e=>{throw e;});
  assert.deepEqual(header,['Cache-Control','no-store']);
  assert.ok(!JSON.stringify(payload).includes('token'));
  const error=new Error('database unavailable');
  installCommunicationStatus({get:(...args)=>route=args},{execute:async()=>{throw error;}},auth);
  let received;
  await route[2]({}, {}, e=>received=e);
  assert.equal(received,error);
});
