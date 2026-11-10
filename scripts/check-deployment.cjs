const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {io} = require('../frontend/node_modules/socket.io-client');
const env = {};
for (const line of fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').split(/\r?\n/)) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2]; }
const base = 'https://scada.lut1x1337.ru:9443';
async function call(endpoint, method='GET', body, cookie) {
  return fetch(base+'/api'+endpoint, { method, headers: {'Content-Type':'application/json', ...(cookie?{Cookie:cookie}:{})}, ...(body?{body:JSON.stringify(body)}:{}) });
}
(async () => {
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await call('/health')).status, 200);
  assert.equal((await call('/catalog')).status, 401);
  const login = await call('/auth/login', 'POST', {email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD});
  assert.equal(login.status, 200);
  const header = login.headers.get('set-cookie');
  assert.match(header, /Secure/); assert.match(header, /HttpOnly/); assert.match(header, /SameSite=Strict/);
  const cookie = header.split(';')[0];
  try {
    const catalog = await call('/catalog', 'GET', null, cookie); assert.equal(catalog.status, 200);
    const data = await catalog.json(); assert.ok(data.sensors.length >= 6);
    assert.equal((await call('/admin/users', 'GET', null, cookie)).status, 200);
    assert.equal((await call('/export?format=csv', 'GET', null, cookie)).status, 200);
    assert.equal((await call('/export?format=sql', 'GET', null, cookie)).status, 200);
    const samples = await new Promise((resolve, reject) => {
      const socket = io(base, {transports:['websocket'],extraHeaders:{Cookie:cookie},reconnection:false});
      const timer = setTimeout(() => {socket.disconnect(); reject(new Error('WebSocket sample timeout'));}, 22000);
      socket.on('connect_error', () => {clearTimeout(timer);socket.disconnect();reject(new Error('WebSocket connection failed'));});
      socket.on('sensor_readings', value => {clearTimeout(timer);socket.disconnect();resolve(value);});
    });
    assert.ok(samples.length); assert.ok(samples.every(s=>data.sensors.some(sensor=>sensor.id===s.sensor_id)));
    console.log('PASS: public HTTPS, admin login, secure cookies, catalog, exports and live WebSocket');
  } finally { await call('/auth/logout', 'POST', {}, cookie); }
  const [local, domain] = env.SMTP_USER.split('@');
  const email = `${local.split('+')[0]}+scadacheck${Date.now()}@${domain}`;
  const password = 'Deployment12!'+crypto.randomBytes(12).toString('hex');
  const pending = await call('/auth/register', 'POST', {email,first_name:'Проверка',last_name:'Развертывания',password,password_confirmation:password});
  assert.equal(pending.status, 202);
  const result = await pending.json();
  assert.match(result.challenge_id, /^[a-f0-9]{64}$/);
  fs.writeFileSync(path.join(__dirname,'../.server-access/deployment-challenge.txt'),result.challenge_id);
  console.log('PASS: Gmail accepted a registration verification message for the configured sender mailbox alias');
})().catch(err=>{console.error('Deployment verification failed:', err.code || err.message);process.exitCode=1;});
