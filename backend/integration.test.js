// Runs against the local Docker dev stack; creates and removes disposable test accounts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
for (const line of fs.readFileSync(process.env.TEST_ENV_FILE || path.join(__dirname, '../.env.local'), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z_]+)=(.*)$/); if (match) process.env[match[1]] = match[2];
}
const { emailIndex } = require('./security');
const base = 'http://localhost';
async function request(url, method = 'GET', body, cookie) {
  const response = await fetch(base + '/api' + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function mail(email, subject) {
  const result = await (await fetch('http://localhost:8025/api/v1/messages?limit=100')).json();
  const entry = result.messages.find(item => item.To.some(to => to.Address === email) && item.Subject.includes(subject));
  assert.ok(entry, 'SMTP message should be delivered to Mailpit');
  return (await fetch(`http://localhost:8025/api/v1/message/${entry.ID}`)).json();
}
test('real MySQL and SMTP: direct registration, encrypted storage, roles and confirmed password reset', async t => {
  const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3307, user: 'root', password: 'techmonitor', database: 'techmonitor' });
  const emails = [];
  let id;
  t.after(async () => {
    for (const email of emails) {
      await conn.execute('DELETE FROM email_challenges WHERE email_index=?', [emailIndex(email)]);
      await conn.execute('DELETE FROM users WHERE email_index=?', [emailIndex(email)]);
    }
    if (id) await conn.execute('DELETE FROM account_audit WHERE target_id=?', [id]);
    await conn.end();
  });
  const admin = await request('/auth/login', 'POST', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  assert.equal(admin.status, 200); assert.equal(admin.data.user.role, 'administrator');
  const email = `scada-test-${crypto.randomBytes(8).toString('hex')}@gmail.com`; emails.push(email);
  const password = 'InitialPassword12!';
  const registration = { email, first_name: 'Тест', last_name: 'Проверка', password, password_confirmation: password, role: 'administrator' };
  assert.equal((await request('/auth/register', 'POST', { ...registration, password: 'weak', password_confirmation: 'weak' })).status, 400);
  assert.equal((await request('/auth/register', 'POST', { ...registration, email: 'invalid-email' })).status, 400);
  const verified = await request('/auth/register', 'POST', registration);
  assert.equal(verified.status, 200); id = verified.data.user.id;
  assert.ok(verified.cookie); assert.equal(verified.data.challenge_id, undefined);
  assert.equal(verified.data.user.email_verified, false); assert.equal(verified.data.user.role, 'operator');
  assert.equal((await request('/auth/me', 'GET', null, verified.cookie)).status, 200);
  assert.equal((await request('/auth/login', 'POST', { email, password })).status, 200);
  const [[{ count }]] = await conn.execute("SELECT COUNT(*) count FROM email_challenges WHERE email_index=? AND purpose='register'", [emailIndex(email)]);
  assert.equal(count, 0);
  const mailbox = await (await fetch('http://localhost:8025/api/v1/messages?limit=100')).json();
  assert.ok(!mailbox.messages.some(item => item.To.some(to => to.Address === email)));
  assert.equal((await request('/auth/register', 'POST', registration)).status, 409);
  const [[stored]] = await conn.execute('SELECT email,first_name,last_name,password_hash FROM users WHERE id=?', [id]);
  assert.match(stored.email, /^v1:/); assert.match(stored.first_name, /^v1:/); assert.match(stored.last_name, /^v1:/); assert.match(stored.password_hash, /^\$argon2id\$/);
  for (const endpoint of ['/readings', '/export?format=csv', '/export?format=sql', '/admin/users']) assert.equal((await request(endpoint, 'GET', null, verified.cookie)).status, 403, endpoint);
  assert.equal((await request('/readings/latest', 'GET', null, verified.cookie)).status, 200);
  assert.equal((await request(`/admin/users/${id}`, 'PATCH', { role: 'technologist' }, admin.cookie)).status, 200);
  assert.equal((await request('/auth/me', 'GET', null, verified.cookie)).status, 401);
  const tech = await request('/auth/login', 'POST', { email, password });
  assert.equal(tech.data.user.role, 'technologist');
  assert.equal((await request('/readings', 'GET', null, tech.cookie)).status, 200);
  assert.equal((await fetch(base + '/api/export?format=csv', { headers: { Cookie: tech.cookie } })).status, 200);
  assert.equal((await request(`/admin/users/${id}/password-reset`, 'POST', { confirmation_email: email, admin_password: password }, tech.cookie)).status, 403);
  assert.equal((await request(`/admin/users/${id}/password-reset`, 'POST', { confirmation_email: email, admin_password: 'wrong' }, admin.cookie)).status, 403);
  const reset = await request(`/admin/users/${id}/password-reset`, 'POST', { confirmation_email: email, admin_password: process.env.ADMIN_PASSWORD }, admin.cookie);
  assert.equal(reset.status, 200);
  const resetMail = await mail(email, 'сброс');
  const resetId = resetMail.Text.match(/reset=([a-f0-9]{64})/)[1];
  const resetCode = resetMail.Text.match(/Код: (\d{6})/)[1];
  assert.equal((await request('/auth/me', 'GET', null, tech.cookie)).status, 200, 'requesting reset must not invalidate session');
  const newPassword = 'ReplacementPassword34!';
  const resetBody = { challenge_id: resetId, code: resetCode, password: newPassword, password_confirmation: newPassword };
  assert.equal((await request('/auth/reset-password', 'POST', { ...resetBody, code: resetCode === '000000' ? '111111' : '000000' })).status, 400);
  assert.equal((await request('/auth/reset-password', 'POST', resetBody)).status, 200);
  assert.equal((await request('/auth/me', 'GET', null, tech.cookie)).status, 401);
  assert.equal((await request('/auth/reset-password', 'POST', resetBody)).status, 400);
  assert.equal((await request('/auth/login', 'POST', { email, password })).status, 401);
  assert.equal((await request('/auth/login', 'POST', { email, password: newPassword })).status, 200);
  const email2 = `scada-test-${crypto.randomBytes(8).toString('hex')}@nonexistent-scada.invalid`; emails.push(email2);
  assert.equal((await request('/auth/register', 'POST', { ...registration, email: email2 })).status, 200, 'registration must not depend on DNS or email delivery');
});
