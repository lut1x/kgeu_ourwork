const crypto = require('node:crypto');
const { PASSWORD_RULE, validPassword, hashPassword, verifyPassword, encrypt, emailIndex, userData } = require('./security');
const { createChallenge, consumeChallenge } = require('./challenges');
const publicUser = 'id, email, first_name, last_name, role, email_verified';
const roles = ['operator', 'technologist', 'administrator'];
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function sessionToken(headers) {
  return (headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('session='))?.slice(8) || '';
}
function installAuth(app, io, pool) {
  const secure = process.env.COOKIE_SECURE === 'true';
  const cookie = (res, token, age) => res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure ? '; Secure' : ''}`);
  async function getUser(headers) {
    const token = sessionToken(headers);
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const [rows] = await pool.execute(`SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.email_verified FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>NOW()`, [digest(token)]);
    return rows[0] ? userData(rows[0]) : null;
  }
  const requireUser = wrap(async (req, res, next) => {
    req.user = await getUser(req.headers);
    if (!req.user) return res.status(401).json({ error: 'Войдите в учетную запись' });
    next();
  });
  const allow = (...allowed) => (req, res, next) => allowed.includes(req.user.role) ? next() : res.status(403).json({ error: 'Недостаточно прав' });
  const attempts = new Map();
  const limiter = (req, res, next) => {
    const now = Date.now();
    for (const [key, item] of attempts) if (item.until < now) attempts.delete(key);
    const key = req.ip;
    const item = attempts.get(key) || { count: 0, until: now + 900000 };
    attempts.set(key, item);
    if (++item.count > 30) return res.status(429).json({ error: 'Слишком много попыток. Повторите через 15 минут' });
    next();
  };
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: 'Недопустимый источник запроса' }); }
      catch { return res.status(403).json({ error: 'Недопустимый источник запроса' }); }
    }
    next();
  });
  async function signIn(res, user) {
    const token = crypto.randomBytes(32).toString('hex');
    await pool.execute('DELETE FROM sessions WHERE expires_at <= NOW()');
    await pool.execute('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 7 DAY))', [digest(token), user.id]);
    cookie(res, token, 604800);
    res.json({ user });
  }
  app.post('/api/auth/register', limiter, wrap(async (req, res) => {
    const { first_name, last_name, email, password, password_confirmation } = req.body;
    if (![first_name, last_name, email, password, password_confirmation].every(v => typeof v === 'string')) return res.status(400).json({ error: 'Заполните все поля' });
    const normalized = email.trim().toLowerCase();
    if (!first_name.trim() || !last_name.trim() || first_name.trim().length > 100 || last_name.trim().length > 100 || normalized.length > 254 || !/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(normalized)) return res.status(400).json({ error: 'Проверьте имя, фамилию и почту' });
    if (!validPassword(password) || password !== password_confirmation) return res.status(400).json({ error: `Требования к паролю: ${PASSWORD_RULE}. Пароли должны совпадать` });
    const index = emailIndex(normalized);
    const [existing] = await pool.execute('SELECT id FROM users WHERE email_index=?', [index]);
    if (existing.length) return res.status(409).json({ error: 'Эта почта уже зарегистрирована' });
    try {
      const [result] = await pool.execute('INSERT INTO users (email,email_index,first_name,last_name,password_hash,email_verified) VALUES (?,?,?,?,?,FALSE)', [encrypt(normalized, 'email'), index, encrypt(first_name.trim(), 'first_name'), encrypt(last_name.trim(), 'last_name'), await hashPassword(password)]);
      await signIn(res, { id: result.insertId, email: normalized, first_name: first_name.trim(), last_name: last_name.trim(), role: 'operator', email_verified: false });
    } catch (err) { if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Эта почта уже зарегистрирована' }); throw err; }
  }));
  app.post('/api/auth/login', limiter, wrap(async (req, res) => {
    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || password.length > 128) return res.status(400).json({ error: 'Проверьте почту и пароль' });
    const [rows] = await pool.execute(`SELECT ${publicUser}, password_hash FROM users WHERE email_index=?`, [emailIndex(email)]);
    const user = rows[0];
    const valid = await verifyPassword(password, user?.password_hash || await hashPassword(crypto.randomBytes(24).toString('hex')));
    if (!user || !valid) return res.status(401).json({ error: 'Неверная почта или пароль' });
    if (!user.password_hash.startsWith('$argon2id$')) await pool.execute('UPDATE users SET password_hash=? WHERE id=?', [await hashPassword(password), user.id]);
    await signIn(res, userData(user));
  }));
  app.get('/api/auth/me', requireUser, (req, res) => res.json({ user: req.user }));
  app.post('/api/auth/logout', wrap(async (req, res) => {
    const token = sessionToken(req.headers);
    await pool.execute('DELETE FROM sessions WHERE token_hash=?', [digest(token)]);
    for (const socket of io.sockets.sockets.values()) if (sessionToken(socket.request.headers) === token) socket.disconnect(true);
    cookie(res, '', 0); res.json({ ok: true });
  }));
  app.get('/api/admin/users', requireUser, allow('administrator'), wrap(async (req, res) => {
    const [users] = await pool.execute(`SELECT ${publicUser} FROM users ORDER BY id`); res.json({ users: users.map(userData) });
  }));
  app.post('/api/admin/users/:id/password-reset', requireUser, allow('administrator'), limiter, wrap(async (req, res) => {
    const { admin_password, confirmation_email } = req.body;
    if (typeof admin_password !== 'string' || admin_password.length > 128 || typeof confirmation_email !== 'string') return res.status(400).json({ error: 'Подтвердите почту пользователя и свой пароль' });
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Неверный id' });
    const [admins] = await pool.execute('SELECT password_hash FROM users WHERE id=? AND role=\'administrator\'', [req.user.id]);
    if (!admins.length || !await verifyPassword(admin_password, admins[0].password_hash)) return res.status(403).json({ error: 'Неверный пароль администратора' });
    const [targets] = await pool.execute(`SELECT ${publicUser} FROM users WHERE id=?`, [id]);
    if (!targets.length) return res.status(404).json({ error: 'Пользователь не найден' });
    const target = userData(targets[0]);
    if (confirmation_email.trim().toLowerCase() !== target.email) return res.status(400).json({ error: 'Почта подтверждения не совпадает' });
    await createChallenge(pool, { purpose: 'reset', email: target.email, index: emailIndex(target.email), payload: {}, userId: id, actorId: req.user.id });
    await pool.execute('INSERT INTO account_audit (actor_id,target_id,action) VALUES (?,?,?)', [req.user.id, id, 'password_reset_requested']);
    res.json({ ok: true, message: 'Письмо для сброса отправлено пользователю. Пароль изменится только после подтверждения кодом.' });
  }));
  app.post('/api/auth/reset-password', limiter, wrap(async (req, res) => {
    const { challenge_id, code, password, password_confirmation } = req.body;
    if (!validPassword(password) || password !== password_confirmation) return res.status(400).json({ error: `Требования: ${PASSWORD_RULE}. Пароли должны совпадать` });
    const hashed = await hashPassword(password);
    const id = await consumeChallenge(pool, challenge_id, code, 'reset', async (conn, payload, row) => {
      const [result] = await conn.execute('UPDATE users SET password_hash=?,email_verified=TRUE WHERE id=?', [hashed, row.user_id]);
      if (!result.affectedRows) throw Object.assign(new Error('Пользователь не найден'), { status: 404 });
      await conn.execute('DELETE FROM sessions WHERE user_id=?', [row.user_id]);
      await conn.execute('INSERT INTO account_audit (actor_id,target_id,action) VALUES (?,?,?)', [row.actor_id, row.user_id, 'password_reset_completed']);
      return row.user_id;
    });
    for (const socket of io.sockets.sockets.values()) if (socket.user.id === id) socket.disconnect(true);
    res.json({ ok: true });
  }));
  async function changeAccount(req, res, deleting) {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Неверный id' });
    if (id === req.user.id) return res.status(400).json({ error: 'Нельзя удалить свою учетную запись или изменить свою роль' });
    if (!deleting && !roles.includes(req.body.role)) return res.status(400).json({ error: 'Неизвестная роль' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [admins] = await conn.execute("SELECT id FROM users WHERE role='administrator' ORDER BY id FOR UPDATE");
      if (!admins.some(u => u.id === req.user.id)) { await conn.rollback(); return res.status(403).json({ error: 'Недостаточно прав' }); }
      const [target] = await conn.execute('SELECT id,role FROM users WHERE id=? FOR UPDATE', [id]);
      if (!target.length) { await conn.rollback(); return res.status(404).json({ error: 'Пользователь не найден' }); }
      if (deleting) await conn.execute('DELETE FROM users WHERE id=?', [id]);
      else { await conn.execute('UPDATE users SET role=? WHERE id=?', [req.body.role, id]); await conn.execute('DELETE FROM sessions WHERE user_id=?', [id]); }
      await conn.commit();
      for (const socket of io.sockets.sockets.values()) if (socket.user.id === id) socket.disconnect(true);
      res.json({ ok: true });
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  }
  app.patch('/api/admin/users/:id', requireUser, allow('administrator'), wrap((req, res) => changeAccount(req, res, false)));
  app.delete('/api/admin/users/:id', requireUser, allow('administrator'), wrap((req, res) => changeAccount(req, res, true)));
  app.get('/api/settings', requireUser, wrap(async (req, res) => { const [rows] = await pool.execute('SELECT temp_warning,temp_critical FROM technical_settings WHERE id=1'); res.json(rows[0]); }));
  app.put('/api/settings', requireUser, allow('technologist', 'administrator'), wrap(async (req, res) => {
    const { temp_warning, temp_critical } = req.body;
    if (![temp_warning, temp_critical].every(v => typeof v === 'number' && Number.isFinite(v)) || temp_warning < 0 || temp_critical > 150 || temp_warning >= temp_critical) return res.status(400).json({ error: 'Пороги должны быть от 0 до 150 °C; предупреждение ниже критического порога' });
    await pool.execute('UPDATE technical_settings SET temp_warning=?,temp_critical=? WHERE id=1', [temp_warning, temp_critical]);
    io.emit('settings_changed', req.body); res.json({ temp_warning, temp_critical });
  }));
  app.use(['/api/readings', '/api/stats', '/api/export'], requireUser);
  app.use('/api/export', allow('technologist', 'administrator'));
  app.use('/api/readings', (req, res, next) => req.path === '/latest' ? next() : allow('technologist', 'administrator')(req, res, next));
  io.use((socket, next) => getUser(socket.request.headers).then(user => { if (!user) return next(new Error('Unauthorized')); socket.user = user; next(); }).catch(next));
  io.on('connection', socket => {
    const timer = setInterval(async () => { try { if (!await getUser(socket.request.headers)) socket.disconnect(true); } catch { socket.disconnect(true); } }, 60000);
    socket.on('disconnect', () => clearInterval(timer));
  });
  return { requireUser, allow };
}
module.exports = { installAuth, hashPassword, verifyPassword };
