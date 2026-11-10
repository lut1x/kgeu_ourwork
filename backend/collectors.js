const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const key = (v, max = 64) => typeof v === 'string' && v.length <= max && /^[a-zA-Z0-9_-]+$/.test(v);
const text = (v, max = 100) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\x00-\x1f]/.test(v);
const finite = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9;
function validateRecord(r) {
  return r && /^[a-f0-9-]{36}$/.test(r.record_id || '') && key(r.device_id) && key(r.channel, 32) && finite(r.value)
    && typeof r.observed_at === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(r.observed_at)
    && Number.isFinite(Date.parse(r.observed_at)) && Date.parse(r.observed_at) >= Date.UTC(2020, 0, 1)
    && Date.parse(r.observed_at) <= Date.now() + 300000;
}
async function migrateCollectors(pool) {
  for (const sql of fs.readFileSync(path.join(__dirname, 'collectors.sql'), 'utf8').split(';').filter(s => s.trim())) await pool.query(sql);
}
function installCollectors(app, pool, { requireUser, allow }, broadcast, io) {
  const admin = [requireUser, allow('administrator')];
  async function device(req) {
    const token = req.headers['x-collector-key'];
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw fail('Неверный ключ шлюза', 401);
    const [rows] = await pool.execute('SELECT id,baud_rate FROM collectors WHERE token_hash=? AND enabled=TRUE', [hash(token)]);
    if (!rows.length) throw fail('Шлюз отключен или ключ неверен', 401);
    return rows[0];
  }
  app.get('/api/admin/collectors', ...admin, wrap(async (req, res) => {
    const [collectors] = await pool.execute('SELECT id,name,enabled,baud_rate,last_seen,status_json FROM collectors ORDER BY id');
    const [devices] = await pool.execute('SELECT d.*,c.sensor_id,c.input_min,c.input_max FROM collector_devices d LEFT JOIN collector_channels c USING (collector_id,device_id,channel) ORDER BY d.collector_id,d.device_id,d.channel');
    res.json({ collectors, devices });
  }));
  app.post('/api/admin/collectors', ...admin, wrap(async (req, res) => {
    if (!text(req.body.name)) throw fail('Введите название шлюза');
    const token = crypto.randomBytes(32).toString('hex');
    const [result] = await pool.execute('INSERT INTO collectors (name,token_hash) VALUES (?,?)', [req.body.name, hash(token)]);
    res.status(201).json({ id: result.insertId, token });
  }));
  app.patch('/api/admin/collectors/:id', ...admin, wrap(async (req, res) => {
    const { enabled, baud_rate } = req.body;
    if (typeof enabled !== 'boolean' || ![9600,19200,38400,57600,115200].includes(baud_rate)) throw fail('Проверьте настройки');
    const [r] = await pool.execute('UPDATE collectors SET enabled=?,baud_rate=? WHERE id=?', [enabled, baud_rate, req.params.id]);
    if (!r.affectedRows) throw fail('Шлюз не найден', 404);
    res.json({ ok: true });
  }));
  app.delete('/api/admin/collectors/:id', ...admin, wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) throw fail('Неверный идентификатор шлюза');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute('SELECT id FROM collectors WHERE id=? FOR UPDATE', [id]);
      if (!rows.length) throw fail('Шлюз не найден', 404);
      // Revoke access and detach hardware; retain SCADA sensors and their history.
      for (const table of ['collector_records', 'collector_channels', 'collector_devices']) {
        await conn.execute(`DELETE FROM ${table} WHERE collector_id=?`, [id]);
      }
      await conn.execute('DELETE FROM collectors WHERE id=?', [id]);
      await conn.commit();
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
    res.json({ ok: true });
  }));
  app.post('/api/admin/collectors/:id/token', ...admin, wrap(async (req, res) => {
    const token = crypto.randomBytes(32).toString('hex');
    const [r] = await pool.execute('UPDATE collectors SET token_hash=? WHERE id=?', [hash(token), req.params.id]);
    if (!r.affectedRows) throw fail('Шлюз не найден', 404);
    res.json({ token });
  }));
  app.put('/api/admin/collectors/:id/channel', ...admin, wrap(async (req, res) => {
    const b = req.body;
    if (!key(b.device_id) || !key(b.channel,32) || !Number.isSafeInteger(b.sensor_id) || !finite(b.input_min) || !finite(b.input_max) || b.input_min >= b.input_max) throw fail('Проверьте канал и входной диапазон');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [d] = await conn.execute('SELECT device_id FROM collector_devices WHERE collector_id=? AND device_id=? AND channel=?', [req.params.id,b.device_id,b.channel]);
      const [s] = await conn.execute('SELECT id FROM sensors WHERE id=?', [b.sensor_id]);
      if (!d.length || !s.length) throw fail('Устройство или датчик не найдены',404);
      // Explicit reassignment; one physical channel per SCADA sensor.
      await conn.execute('DELETE FROM collector_channels WHERE sensor_id=? OR (collector_id=? AND device_id=? AND channel=?)', [b.sensor_id,req.params.id,b.device_id,b.channel]);
      await conn.execute('INSERT INTO collector_channels VALUES (?,?,?,?,?,?)', [req.params.id,b.device_id,b.channel,b.sensor_id,b.input_min,b.input_max]);
      await conn.commit();
    } catch(e) { await conn.rollback(); throw e; } finally { conn.release(); }
    res.json({ ok: true });
  }));
  app.delete('/api/admin/collectors/:id/channel', ...admin, wrap(async (req,res) => {
    if (!key(req.body.device_id) || !key(req.body.channel,32)) throw fail('Неверный канал');
    await pool.execute('DELETE FROM collector_channels WHERE collector_id=? AND device_id=? AND channel=?', [req.params.id,req.body.device_id,req.body.channel]);
    res.json({ok:true});
  }));
  app.post('/api/collector/v1/sync', wrap(async (req, res) => {
    const c = await device(req); const b = req.body;
    if (!Array.isArray(b.devices) || b.devices.length > 64 || !Array.isArray(b.ports) || b.ports.length > 32 || b.ports.some(p => !text(p,150)) || !Number.isSafeInteger(b.queued) || b.queued < 0) throw fail('Неверный статус');
    for (const d of b.devices) if (!key(d.device_id) || !key(d.channel,32) || !text(d.name) || !text(d.port,150) || !Number.isFinite(Date.parse(d.last_seen)) || Date.parse(d.last_seen) > Date.now()+300000) throw fail('Неверное устройство');
    await pool.execute('UPDATE collectors SET last_seen=NOW(3),status_json=? WHERE id=?', [JSON.stringify({ports:b.ports,queued:b.queued,version:String(b.version || '').slice(0,30),error:String(b.error || '').slice(0,200)}),c.id]);
    for (const d of b.devices) await pool.execute('INSERT INTO collector_devices VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),port=VALUES(port),last_seen=GREATEST(last_seen,VALUES(last_seen))', [c.id,d.device_id,d.channel,d.name,d.port,new Date(d.last_seen)]);
    const [channels] = await pool.execute('SELECT c.device_id,c.channel FROM collector_channels c JOIN sensors s ON s.id=c.sensor_id WHERE c.collector_id=? AND s.enabled=TRUE', [c.id]);
    res.json({ baud_rate:c.baud_rate, channels });
  }));
  app.post('/api/collector/v1/batches', wrap(async (req, res) => {
    const c = await device(req); const records = req.body.records;
    if (!Array.isArray(records) || !records.length || records.length > 50 || !records.every(validateRecord)) throw fail('Неверный пакет показаний');
    const ack = [], rejected = [], samples = []; const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const r of records) {
        const digest = hash(JSON.stringify([r.device_id,r.channel,r.value,r.observed_at]));
        const [prior] = await conn.execute('SELECT payload_hash FROM collector_records WHERE collector_id=? AND record_id=? FOR UPDATE',[c.id,r.record_id]);
        if (prior.length) { if (prior[0].payload_hash !== digest) throw fail('Конфликт идентификатора записи',409); ack.push(r.record_id); continue; }
        const [m] = await conn.execute('SELECT s.id,s.enabled,s.min_value,s.max_value,c.input_min,c.input_max FROM collector_channels c JOIN sensors s ON s.id=c.sensor_id WHERE c.collector_id=? AND c.device_id=? AND c.channel=?',[c.id,r.device_id,r.channel]);
        if (!m.length || !m[0].enabled) { rejected.push({record_id:r.record_id,reason:'channel_unassigned_or_disabled'}); continue; }
        const s = m[0]; const value = s.min_value + (r.value-s.input_min)*(s.max_value-s.min_value)/(s.input_max-s.input_min);
        if (!finite(value)) throw fail('Значение вне допустимого диапазона');
        await conn.execute('INSERT INTO collector_records (collector_id,record_id,payload_hash) VALUES (?,?,?)',[c.id,r.record_id,digest]);
        const [result] = await conn.execute('INSERT INTO sensor_samples (sensor_id,value,created_at) VALUES (?,?,?)',[s.id,value,new Date(r.observed_at)]);
        samples.push({id:result.insertId,sensor_id:s.id,value,created_at:r.observed_at}); ack.push(r.record_id);
      }
      await conn.commit();
    } catch(e) { await conn.rollback(); throw e; } finally { conn.release(); }
    res.status(201).json({ack,rejected});
    if (samples.length) broadcast(samples).catch(e => console.error('Collector broadcast failed',e.code));
  }));
}
module.exports = { installCollectors, migrateCollectors, validateRecord };
