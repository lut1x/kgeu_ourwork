const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { userData } = require('./security');
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const kinds = ['temperature', 'rpm', 'voltage', 'pressure', 'flow', 'custom'];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function idOf(value) { const id = Number(value); if (!Number.isSafeInteger(id) || id < 1) throw fail('Неверный идентификатор'); return id; }
function nameOf(value, length = 100) { if (typeof value !== 'string' || !value.trim() || value.trim().length > length || /[\x00-\x1f]/.test(value)) throw fail('Проверьте название'); return value.trim(); }
function scope(user, alias = 's') {
  if (user.role === 'administrator') return { sql: `${alias}.enabled=TRUE`, args: [] };
  return { sql: `${alias}.enabled=TRUE AND EXISTS (SELECT 1 FROM user_group_access a WHERE a.user_id=? AND a.group_id=${alias}.group_id) AND NOT EXISTS (SELECT 1 FROM user_hidden_sensors h WHERE h.user_id=? AND h.sensor_id=${alias}.id)`, args: [user.id, user.id] };
}
async function migrateTelemetry(pool) {
  if (!/^[a-f0-9]{64}$/i.test(process.env.INGEST_API_KEY || '')) throw new Error('Set random INGEST_API_KEY (64 hex characters)');
  for (const sql of fs.readFileSync(path.join(__dirname, 'telemetry.sql'), 'utf8').split(';').filter(s => s.trim())) await pool.query(sql);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [done] = await conn.execute("SELECT name FROM telemetry_migrations WHERE name='multi-sensor-v1' FOR UPDATE");
    if (!done.length) {
      await conn.execute("INSERT INTO sensor_groups (id,name) VALUES (1,'Контур охлаждения'),(2,'Производственная линия')");
      const initial = [
        [1, 'temp_01', 'Температура процессора', 'temperature', '°C', 0, 100, 60, 75],
        [1, 'fan_01', 'Вентилятор охлаждения', 'rpm', 'RPM', 0, 6000, 4200, 5000],
        [1, 'voltage_01', 'Напряжение питания', 'voltage', 'V', 0, 6, 4.8, 5.2],
        [2, 'temp_02', 'Температура теплоносителя', 'temperature', '°C', 0, 120, 80, 100],
        [2, 'pressure_01', 'Давление в линии', 'pressure', 'bar', 0, 10, 7, 9],
        [2, 'flow_01', 'Расход теплоносителя', 'flow', 'л/мин', 0, 150, 110, 135],
      ];
      for (const sensor of initial) await conn.execute('INSERT INTO sensors (group_id,sensor_key,name,kind,unit,min_value,max_value,warning_value,critical_value) VALUES (?,?,?,?,?,?,?,?,?)', sensor);
      // Preserve existing users' previous access to the original three metrics only.
      await conn.execute("INSERT INTO user_group_access (user_id,group_id) SELECT id,1 FROM users WHERE role<>'administrator'");
      for (const [key, column] of [['temp_01', 'cpu_temp'], ['fan_01', 'fan_speed'], ['voltage_01', 'voltage']]) {
        await conn.execute(`INSERT INTO sensor_samples (sensor_id,value,created_at) SELECT s.id,r.${column},r.created_at FROM readings r JOIN sensors s ON s.sensor_key=?`, [key]);
      }
      await conn.execute("INSERT INTO telemetry_migrations (name) VALUES ('multi-sensor-v1')");
    }
    await conn.commit();
  } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
}
function parameters(body) {
  const { min_value, max_value, warning_value, critical_value } = body;
  if (![min_value, max_value].every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9) || min_value >= max_value) throw fail('Минимум должен быть меньше максимума');
  for (const v of [warning_value, critical_value]) if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < min_value || v > max_value)) throw fail('Пороги должны находиться в диапазоне датчика');
  if (warning_value !== null && critical_value !== null && warning_value >= critical_value) throw fail('Предупреждение должно быть ниже критического порога');
  return [min_value, max_value, warning_value, critical_value];
}
function installTelemetry(app, io, pool, { requireUser, allow }) {
  const admin = allow('administrator'); const engineer = allow('technologist', 'administrator');
  const catalogChanged = () => io.emit('catalog_changed');
  async function visibleSensors(user) {
    const access = scope(user);
    const [rows] = await pool.execute(`SELECT s.*,g.name AS group_name,p.value,p.created_at FROM sensors s JOIN sensor_groups g ON g.id=s.group_id LEFT JOIN sensor_samples p ON p.id=(SELECT p2.id FROM sensor_samples p2 WHERE p2.sensor_id=s.id ORDER BY p2.created_at DESC,p2.id DESC LIMIT 1) WHERE ${access.sql} ORDER BY g.id,s.id`, access.args);
    return rows.map(({ token_hash, ...sensor }) => sensor);
  }
  async function broadcast(samples) {
    // Recheck DB permissions for every delivery; don't trust cached client roles or subscriptions.
    for (const socket of io.sockets.sockets.values()) {
      const [users] = await pool.execute('SELECT id,role FROM users WHERE id=?', [socket.user.id]);
      if (!users.length) continue;
      const access = scope(users[0]);
      const [ids] = await pool.execute(`SELECT s.id FROM sensors s WHERE ${access.sql}`, access.args);
      const allowed = new Set(ids.map(s => s.id));
      const filtered = samples.filter(sample => allowed.has(sample.sensor_id));
      if (filtered.length) socket.emit('sensor_readings', filtered);
    }
  }
  app.post('/api/data', wrap(async (req, res) => {
    const collector = typeof req.headers['x-ingest-key'] === 'string' && hash(req.headers['x-ingest-key']) === hash(process.env.INGEST_API_KEY);
    let readings = req.body.readings;
    if (!readings) readings = req.body.sensor_key ? [{ sensor_key: req.body.sensor_key, value: req.body.value }] : [
      { sensor_key: 'temp_01', value: req.body.cpu_temp }, { sensor_key: 'fan_01', value: req.body.fan_speed }, { sensor_key: 'voltage_01', value: req.body.voltage },
    ].filter(r => r.value !== undefined);
    if (!Array.isArray(readings) || !readings.length || readings.length > 100) throw fail('Передайте от 1 до 100 показаний');
    if (!collector && readings.length !== 1) throw fail('Нужен ключ коллектора', 401);
    const prepared = [];
    for (const reading of readings) {
      if (typeof reading.sensor_key !== 'string' || typeof reading.value !== 'number' || !Number.isFinite(reading.value) || Math.abs(reading.value) > 1e9) throw fail('Неверный ключ или числовое значение датчика');
      const [rows] = await pool.execute('SELECT id,token_hash,enabled FROM sensors WHERE sensor_key=?', [reading.sensor_key]);
      if (!rows.length) throw fail('Датчик не найден или отключен', 404);
      if (!rows[0].enabled) { if (collector) continue; throw fail('Датчик отключен', 404); }
      if (!collector && (!rows[0].token_hash || hash(String(req.headers['x-sensor-token'] || '')) !== rows[0].token_hash)) throw fail('Неверный ключ подключения', 401);
      prepared.push({ sensor_id: rows[0].id, value: reading.value });
    }
    const conn = await pool.getConnection(); const samples = [];
    try {
      await conn.beginTransaction();
      for (const reading of prepared) { const [result] = await conn.execute('INSERT INTO sensor_samples (sensor_id,value) VALUES (?,?)', [reading.sensor_id, reading.value]); samples.push({ id: result.insertId, ...reading, created_at: new Date().toISOString() }); }
      await conn.commit();
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
    res.status(201).json({ samples });
    broadcast(samples).catch(err => console.error('Telemetry delivery failed:', err.code || 'INTERNAL'));
  }));
  app.get('/api/catalog', requireUser, wrap(async (req, res) => {
    const [groups] = await pool.execute(req.user.role === 'administrator' ? 'SELECT id,name FROM sensor_groups ORDER BY id' : 'SELECT g.id,g.name FROM sensor_groups g JOIN user_group_access a ON a.group_id=g.id WHERE a.user_id=? ORDER BY g.id', req.user.role === 'administrator' ? [] : [req.user.id]);
    res.json({ groups, sensors: await visibleSensors(req.user) });
  }));
  app.get('/api/readings/latest', wrap(async (req, res) => { const sensors = await visibleSensors(req.user); res.json(sensors.length ? sensors[0] : null); }));
  async function history(user, query, all = false) {
    const access = scope(user); const where = [access.sql]; const args = [...access.args];
    if (query.sensor_id) { where.push('s.id=?'); args.push(idOf(query.sensor_id)); }
    if (query.group_id) { where.push('s.group_id=?'); args.push(idOf(query.group_id)); }
    const limit = Math.min(Math.max(parseInt(query.limit) || 50, 1), 1000); const offset = Math.max(parseInt(query.offset) || 0, 0);
    const from = 'FROM sensor_samples p JOIN sensors s ON s.id=p.sensor_id JOIN sensor_groups g ON g.id=s.group_id WHERE ' + where.join(' AND ');
    const [rows] = await pool.execute(`SELECT p.*,s.name AS sensor_name,s.sensor_key,s.unit,s.kind,g.name AS group_name ${from} ORDER BY p.id ${all ? 'ASC' : `DESC LIMIT ${limit} OFFSET ${offset}`}`, args);
    const [[count]] = await pool.execute(`SELECT COUNT(*) AS total ${from}`, args);
    return { data: rows, total: count.total, limit, offset };
  }
  app.get('/api/readings', wrap(async (req, res) => res.json(await history(req.user, req.query))));
  app.get('/api/export', wrap(async (req, res) => {
    const rows = (await history(req.user, req.query, true)).data;
    const format = req.query.format || 'csv';
    if (!['csv', 'sql'].includes(format)) throw fail('Выберите CSV или SQL');
    let data;
    if (format === 'csv') {
      const cell = value => '"' + (/^[\s]*[=+\-@]/.test(String(value)) ? "'" : '') + String(value ?? '').replace(/"/g, '""') + '"';
      data = '\uFEFFid,sensor_key,sensor_name,group_name,value,unit,created_at\n' + rows.map(row => [row.id, cell(row.sensor_key), cell(row.sensor_name), cell(row.group_name), row.value, cell(row.unit), new Date(row.created_at).toISOString()].join(',')).join('\n');
    } else {
      const text = value => `CONVERT(0x${Buffer.from(String(value), 'utf8').toString('hex')} USING utf8mb4)`;
      data = '-- Export of visible sensors only\nCREATE TABLE IF NOT EXISTS sensor_export (id BIGINT, sensor_key VARCHAR(64), sensor_name VARCHAR(100), group_name VARCHAR(100), value DOUBLE, unit VARCHAR(20), created_at DATETIME(3));\n';
      for (const row of rows) data += `INSERT INTO sensor_export VALUES (${row.id},${text(row.sensor_key)},${text(row.sensor_name)},${text(row.group_name)},${Number(row.value)},${text(row.unit)},'${new Date(row.created_at).toISOString().slice(0, 23).replace('T', ' ')}');\n`;
    }
    res.setHeader('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/sql'); res.setHeader('Content-Disposition', `attachment; filename="sensors.${format}"`); res.send(data);
  }));
  app.get('/api/stats', wrap(async (req, res) => res.json({ sensors: (await visibleSensors(req.user)).length })));
  app.get('/api/admin/catalog', requireUser, admin, wrap(async (req, res) => {
    const [groups] = await pool.execute('SELECT * FROM sensor_groups ORDER BY id');
    const [sensors] = await pool.execute('SELECT id,group_id,sensor_key,name,kind,unit,min_value,max_value,warning_value,critical_value,enabled FROM sensors ORDER BY id');
    const [users] = await pool.execute('SELECT id,email,first_name,last_name,role,email_verified FROM users ORDER BY id');
    const [grants] = await pool.execute('SELECT * FROM user_group_access'); const [hidden] = await pool.execute('SELECT * FROM user_hidden_sensors');
    res.json({ groups, sensors, users: users.map(userData), grants, hidden });
  }));
  app.post('/api/admin/groups', requireUser, admin, wrap(async (req, res) => { const [result] = await pool.execute('INSERT INTO sensor_groups (name) VALUES (?)', [nameOf(req.body.name)]); catalogChanged(); res.status(201).json({ id: result.insertId }); }));
  app.patch('/api/admin/groups/:id', requireUser, admin, wrap(async (req, res) => { const [result] = await pool.execute('UPDATE sensor_groups SET name=? WHERE id=?', [nameOf(req.body.name), idOf(req.params.id)]); if (!result.affectedRows) throw fail('Группа не найдена', 404); catalogChanged(); res.json({ ok: true }); }));
  app.post('/api/admin/sensors', requireUser, admin, wrap(async (req, res) => {
    const key = req.body.sensor_key;
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{2,64}$/.test(key) || !kinds.includes(req.body.kind)) throw fail('Ключ: 2–64 латинских символа, цифры, _ или -');
    const token = crypto.randomBytes(32).toString('hex');
    try {
      const [result] = await pool.execute('INSERT INTO sensors (group_id,sensor_key,name,kind,unit,min_value,max_value,warning_value,critical_value,token_hash) VALUES (?,?,?,?,?,?,?,?,?,?)', [idOf(req.body.group_id), key, nameOf(req.body.name), req.body.kind, nameOf(req.body.unit, 20), ...parameters(req.body), hash(token)]);
      catalogChanged(); res.status(201).json({ id: result.insertId, sensor_token: token });
    } catch (err) { if (err.code === 'ER_DUP_ENTRY') throw fail('Ключ датчика уже существует', 409); if (err.code === 'ER_NO_REFERENCED_ROW_2') throw fail('Группа не найдена'); throw err; }
  }));
  app.patch('/api/admin/sensors/:id', requireUser, admin, wrap(async (req, res) => {
    if (!kinds.includes(req.body.kind) || typeof req.body.enabled !== 'boolean') throw fail('Проверьте тип и состояние датчика');
    const [result] = await pool.execute('UPDATE sensors SET group_id=?,name=?,kind=?,unit=?,min_value=?,max_value=?,warning_value=?,critical_value=?,enabled=? WHERE id=?', [idOf(req.body.group_id), nameOf(req.body.name), req.body.kind, nameOf(req.body.unit, 20), ...parameters(req.body), req.body.enabled, idOf(req.params.id)]);
    if (!result.affectedRows) throw fail('Датчик не найден', 404); catalogChanged(); res.json({ ok: true });
  }));
  app.post('/api/admin/sensors/:id/token', requireUser, admin, wrap(async (req, res) => { const token = crypto.randomBytes(32).toString('hex'); const [result] = await pool.execute('UPDATE sensors SET token_hash=? WHERE id=?', [hash(token), idOf(req.params.id)]); if (!result.affectedRows) throw fail('Датчик не найден', 404); res.json({ sensor_token: token }); }));
  app.put('/api/admin/users/:id/sensor-access', requireUser, admin, wrap(async (req, res) => {
    const id = idOf(req.params.id); const { group_ids, hidden_sensor_ids } = req.body;
    if (!Array.isArray(group_ids) || !Array.isArray(hidden_sensor_ids) || group_ids.length > 1000 || hidden_sensor_ids.length > 1000) throw fail('Неверный список доступа');
    const groups = [...new Set(group_ids.map(idOf))]; const hidden = [...new Set(hidden_sensor_ids.map(idOf))];
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [users] = await conn.execute('SELECT role FROM users WHERE id=? FOR UPDATE', [id]);
      if (!users.length) throw fail('Пользователь не найден', 404);
      if (users[0].role === 'administrator') throw fail('Администратор видит все группы');
      const [knownGroups] = await conn.execute('SELECT id FROM sensor_groups'); const [knownSensors] = await conn.execute('SELECT id,group_id FROM sensors');
      if (groups.some(g => !knownGroups.some(k => k.id === g)) || hidden.some(s => !knownSensors.some(k => k.id === s && groups.includes(k.group_id)))) throw fail('Скрывайте датчики только внутри назначенных групп');
      await conn.execute('DELETE FROM user_group_access WHERE user_id=?', [id]); await conn.execute('DELETE FROM user_hidden_sensors WHERE user_id=?', [id]);
      for (const group of groups) await conn.execute('INSERT INTO user_group_access VALUES (?,?)', [id, group]);
      for (const sensor of hidden) await conn.execute('INSERT INTO user_hidden_sensors VALUES (?,?)', [id, sensor]);
      await conn.commit();
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
    catalogChanged(); res.json({ ok: true });
  }));
  app.put('/api/sensors/:id/parameters', requireUser, engineer, wrap(async (req, res) => {
    const access = scope(req.user); const id = idOf(req.params.id);
    const [rows] = await pool.execute(`SELECT s.id FROM sensors s WHERE s.id=? AND ${access.sql}`, [id, ...access.args]);
    if (!rows.length) throw fail('Датчик недоступен', 404);
    await pool.execute('UPDATE sensors SET min_value=?,max_value=?,warning_value=?,critical_value=? WHERE id=?', [...parameters(req.body), id]);
    catalogChanged(); res.json({ ok: true });
  }));
  return { broadcast };
}
module.exports = { migrateTelemetry, installTelemetry, scope };
