const crypto = require('node:crypto');
const { encrypt, decrypt, keyedDigest } = require('./security');
const { sendCode } = require('./mail');
const codeHash = (id, code) => keyedDigest(`${id}:${code}`, 'email-code');
async function createChallenge(pool, { purpose, email, index, payload, userId = null, actorId = null }) {
  const id = crypto.randomBytes(32).toString('hex');
  const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
  // Serialize issuance per email/purpose. This preserves resend cooldown across replicas.
  const conn = await pool.getConnection();
  const lockName = `mail:${index.slice(0, 48)}:${purpose}`;
  try {
    const [[lock]] = await conn.execute('SELECT GET_LOCK(?,5) AS acquired', [lockName]);
    if (!lock.acquired) throw Object.assign(new Error('Повторите запрос позже'), { status: 429 });
    const [recent] = await conn.execute('SELECT id FROM email_challenges WHERE email_index=? AND purpose=? AND created_at>DATE_SUB(NOW(),INTERVAL 60 SECOND) LIMIT 1', [index, purpose]);
    if (recent.length) throw Object.assign(new Error('Повторная отправка доступна через 60 секунд'), { status: 429 });
    await conn.execute('INSERT INTO email_challenges (id,purpose,email_index,payload,code_hash,user_id,actor_id,expires_at) VALUES (?,?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL 10 MINUTE))', [id, purpose, index, encrypt(JSON.stringify(payload), `challenge:${id}`), codeHash(id, code), userId, actorId]);
    try { await sendCode(email, code, purpose, id); }
    catch (err) { await conn.execute('DELETE FROM email_challenges WHERE id=?', [id]); throw err; }
    await conn.execute('DELETE FROM email_challenges WHERE email_index=? AND purpose=? AND id<>?', [index, purpose, id]);
  } finally { await conn.execute('SELECT RELEASE_LOCK(?)', [lockName]); conn.release(); }
  return { challenge_id: id, expires_in: 600, resend_after: 60 };
}
async function consumeChallenge(pool, id, code, purpose, action) {
  if (!/^[a-f0-9]{64}$/.test(id || '') || !/^\d{6}$/.test(code || '')) throw Object.assign(new Error('Введите шестизначный код'), { status: 400 });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT *, expires_at>NOW() AS active FROM email_challenges WHERE id=? AND purpose=? FOR UPDATE', [id, purpose]);
    const row = rows[0];
    if (!row || !row.active || row.attempts >= 5) { await conn.rollback(); throw Object.assign(new Error('Код истек или исчерпаны попытки. Запросите новое письмо'), { status: 400 }); }
    if (!crypto.timingSafeEqual(Buffer.from(row.code_hash, 'hex'), Buffer.from(codeHash(id, code), 'hex'))) {
      await conn.execute('UPDATE email_challenges SET attempts=attempts+1 WHERE id=?', [id]); await conn.commit();
      throw Object.assign(new Error('Неверный код'), { status: 400 });
    }
    const result = await action(conn, JSON.parse(decrypt(row.payload, `challenge:${id}`)), row);
    await conn.execute('DELETE FROM email_challenges WHERE id=?', [id]);
    await conn.commit(); return result;
  } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
}
module.exports = { createChallenge, consumeChallenge };
