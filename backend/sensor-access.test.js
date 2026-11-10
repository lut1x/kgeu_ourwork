const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const { io } = require('../frontend/node_modules/socket.io-client');
for (const line of fs.readFileSync(process.env.TEST_ENV_FILE || path.join(__dirname, '../.env.local'), 'utf8').split(/\r?\n/)) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
const { encrypt, emailIndex, hashPassword } = require('./security');
const url = 'http://localhost';
async function call(endpoint, method = 'GET', body, cookie, headers = {}) {
  const res = await fetch(url + '/api' + endpoint, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
test('group grants and sensor exclusions cover HTTP, export, live delivery and admin-only edits', async t => {
  const db = await mysql.createConnection({ host: '127.0.0.1', port: 3307, user: 'root', password: 'techmonitor', database: 'techmonitor' });
  const users = [], groups = [], sensors = []; const sockets = [];
  t.after(async () => {
    sockets.forEach(s => s.disconnect());
    for (const id of users) await db.execute('DELETE FROM users WHERE id=?', [id]);
    for (const id of sensors) { await db.execute('DELETE FROM sensor_samples WHERE sensor_id=?', [id]); await db.execute('DELETE FROM sensors WHERE id=?', [id]); }
    for (const id of groups) await db.execute('DELETE FROM sensor_groups WHERE id=?', [id]);
    await db.end();
  });
  const admin = await call('/auth/login', 'POST', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }); assert.equal(admin.status, 200);
  const suffix = crypto.randomBytes(5).toString('hex');
  const password = 'SensorTestPassword12!';
  async function user(role) {
    const email = `${role}-${suffix}@gmail.com`;
    const [created] = await db.execute('INSERT INTO users (email,email_index,first_name,last_name,role,password_hash,email_verified) VALUES (?,?,?,?,?,?,TRUE)', [encrypt(email, 'email'), emailIndex(email), encrypt('Тест', 'first_name'), encrypt(role, 'last_name'), role, await hashPassword(password)]);
    users.push(created.insertId); const login = await call('/auth/login', 'POST', { email, password }); assert.equal(login.status, 200); return { id: created.insertId, cookie: login.cookie };
  }
  const operator = await user('operator'); const tech = await user('technologist');
  const newGroup = await call('/admin/groups', 'POST', { name: `Тест A ${suffix}` }, admin.cookie); assert.equal(newGroup.status, 201); groups.push(newGroup.data.id);
  const otherGroup = await call('/admin/groups', 'POST', { name: `Тест B ${suffix}` }, admin.cookie); assert.equal(otherGroup.status, 201); groups.push(otherGroup.data.id);
  const spec = { group_id: groups[0], sensor_key: `s_${suffix}_1`, name: 'Скрытый датчик', kind: 'temperature', unit: '°C', min_value: 0, max_value: 100, warning_value: 60, critical_value: 80 };
  for (const actor of [operator, tech]) {
    assert.equal((await call('/admin/groups', 'POST', { name: 'Нельзя' }, actor.cookie)).status, 403);
    assert.equal((await call('/admin/sensors', 'POST', spec, actor.cookie)).status, 403);
    assert.equal((await call(`/admin/groups/${groups[0]}`, 'PATCH', { name: 'Нельзя' }, actor.cookie)).status, 403);
  }
  for (let i = 1; i <= 3; i++) {
    const result = await call('/admin/sensors', 'POST', { ...spec, group_id: i === 3 ? groups[1] : groups[0], sensor_key: `s_${suffix}_${i}`, name: `Тестовый датчик ${i}` }, admin.cookie);
    assert.equal(result.status, 201); sensors.push(result.data.id);
    if (i === 1) {
      assert.equal((await call('/data', 'POST', { sensor_key: `s_${suffix}_1`, value: 99 })).status, 401);
      assert.equal((await call('/data', 'POST', { sensor_key: `s_${suffix}_1`, value: 99 }, null, { 'X-Sensor-Token': result.data.sensor_token })).status, 201);
    }
  }
  assert.equal((await call('/catalog', 'GET', null, operator.cookie)).data.sensors.length, 0);
  assert.equal((await call(`/admin/users/${operator.id}/sensor-access`, 'PUT', { group_ids: [groups[0]], hidden_sensor_ids: [sensors[0]] }, admin.cookie)).status, 200);
  assert.equal((await call(`/admin/users/${tech.id}/sensor-access`, 'PUT', { group_ids: [groups[0]], hidden_sensor_ids: [sensors[0]] }, admin.cookie)).status, 200);
  for (const actor of [operator, tech]) {
    const catalog = await call('/catalog', 'GET', null, actor.cookie); assert.deepEqual(catalog.data.sensors.map(s => s.id), [sensors[1]]); assert.deepEqual(catalog.data.groups.map(g => g.id), [groups[0]]);
    assert.equal((await call(`/admin/sensors/${sensors[1]}`, 'PATCH', { ...spec, enabled: true }, actor.cookie)).status, 403);
  }
  const socket = io(url, { transports: ['websocket'], extraHeaders: { Cookie: tech.cookie }, reconnection: false }); sockets.push(socket);
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Socket did not connect')), 5000); socket.once('connect', () => { clearTimeout(timer); resolve(); }); socket.once('connect_error', reject); });
  const event = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Telemetry event missing')), 5000); socket.once('sensor_readings', readings => { clearTimeout(timer); resolve(readings); }); });
  const sent = await call('/data', 'POST', { readings: sensors.map((id, i) => ({ sensor_key: `s_${suffix}_${i + 1}`, value: [99, 42, 77][i] })) }, null, { 'X-Ingest-Key': process.env.INGEST_API_KEY }); assert.equal(sent.status, 201);
  assert.deepEqual((await event).map(r => r.sensor_id), [sensors[1]]);
  const history = await call('/readings', 'GET', null, tech.cookie); assert.ok(history.data.data.length); assert.ok(history.data.data.every(r => r.sensor_id === sensors[1]));
  assert.equal((await call(`/readings?sensor_id=${sensors[0]}`, 'GET', null, tech.cookie)).data.total, 0);
  assert.equal((await call(`/readings?group_id=${groups[1]}`, 'GET', null, tech.cookie)).data.total, 0);
  for (const format of ['csv', 'sql']) {
    const exported = await call(`/export?format=${format}`, 'GET', null, tech.cookie); assert.equal(exported.status, 200);
    assert.equal(exported.data.includes(`s_${suffix}_1`), false); assert.equal(exported.data.includes(`s_${suffix}_3`), false);
  }
  assert.equal((await call('/export', 'GET', null, operator.cookie)).status, 403);
  const params = { min_value: 0, max_value: 120, warning_value: 70, critical_value: 95 };
  assert.equal((await call(`/sensors/${sensors[1]}/parameters`, 'PUT', params, operator.cookie)).status, 403);
  assert.equal((await call(`/sensors/${sensors[0]}/parameters`, 'PUT', params, tech.cookie)).status, 404);
  assert.equal((await call(`/sensors/${sensors[1]}/parameters`, 'PUT', params, tech.cookie)).status, 200);
  assert.equal((await call(`/admin/users/${tech.id}/sensor-access`, 'PUT', { group_ids: [], hidden_sensor_ids: [] }, admin.cookie)).status, 200);
  assert.equal((await call('/catalog', 'GET', null, tech.cookie)).data.sensors.length, 0);
  assert.equal((await call('/readings', 'GET', null, tech.cookie)).data.total, 0);
  const receivedAfterRevocation = []; socket.on('sensor_readings', values => receivedAfterRevocation.push(...values));
  await call('/data', 'POST', { sensor_key: `s_${suffix}_2`, value: 44 }, null, { 'X-Ingest-Key': process.env.INGEST_API_KEY });
  await new Promise(resolve => setTimeout(resolve, 250)); assert.equal(receivedAfterRevocation.length, 0);
  const renamed = await call(`/admin/sensors/${sensors[1]}`, 'PATCH', { ...spec, name: 'Новое имя', enabled: true }, admin.cookie); assert.equal(renamed.status, 200);
});
