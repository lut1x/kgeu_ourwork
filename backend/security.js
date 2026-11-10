const crypto = require('node:crypto');
const { promisify } = require('node:util');
const argon2 = require('argon2');
const scrypt = promisify(crypto.scrypt);
const PASSWORD_RULE = '12–128 символов, заглавная и строчная буквы, цифра и спецсимвол';
function validPassword(value) {
  return typeof value === 'string' && value.length >= 12 && value.length <= 128 && /\p{Lu}/u.test(value) && /\p{Ll}/u.test(value) && /[0-9]/.test(value) && /[\p{P}\p{S}]/u.test(value) && !/\s/u.test(value);
}
const hashPassword = password => argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
async function verifyPassword(password, stored) {
  if (stored?.startsWith('$argon2id$')) return argon2.verify(stored, password);
  if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored || '')) return false;
  const [salt, hash] = stored.split(':');
  const actual = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
function keyMaterial() {
  if (!/^[a-f0-9]{64}$/i.test(process.env.ACCOUNT_ENCRYPTION_KEY || '')) throw new Error('ACCOUNT_ENCRYPTION_KEY must contain 32 random bytes as 64 hex characters');
  return Buffer.from(process.env.ACCOUNT_ENCRYPTION_KEY, 'hex');
}
function encrypt(value, context) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyMaterial(), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')}`;
}
function decrypt(value, context) {
  if (!value.startsWith('v1:')) throw new Error('Unsupported ciphertext');
  const data = Buffer.from(value.slice(3), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyMaterial(), data.subarray(0, 12));
  decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}
function keyedDigest(value, purpose) {
  const key = crypto.hkdfSync('sha256', keyMaterial(), Buffer.alloc(0), Buffer.from(purpose), 32);
  return crypto.createHmac('sha256', key).update(value).digest('hex');
}
const emailIndex = email => keyedDigest(email.trim().toLowerCase(), 'email-index');
function userData(row) {
  return { id: row.id, email: decrypt(row.email, 'email'), first_name: decrypt(row.first_name, 'first_name'), last_name: decrypt(row.last_name, 'last_name'), role: row.role, email_verified: Boolean(row.email_verified) };
}
async function migrateAccounts(pool) {
  keyMaterial();
  const [columns] = await pool.query('SHOW COLUMNS FROM users');
  if (!columns.some(c => c.Field === 'email_index')) await pool.query('ALTER TABLE users ADD COLUMN email_index CHAR(64) NULL UNIQUE');
  if (!columns.some(c => c.Field === 'email_verified')) await pool.query('ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query('ALTER TABLE users MODIFY email VARCHAR(512) NOT NULL, MODIFY first_name TEXT NOT NULL, MODIFY last_name TEXT NOT NULL');
  const [rows] = await pool.execute('SELECT id,email,first_name,last_name FROM users WHERE email_index IS NULL');
  for (const row of rows) await pool.execute('UPDATE users SET email=?,first_name=?,last_name=?,email_index=? WHERE id=? AND email_index IS NULL', [encrypt(row.email, 'email'), encrypt(row.first_name, 'first_name'), encrypt(row.last_name, 'last_name'), emailIndex(row.email), row.id]);
  await pool.query('ALTER TABLE users MODIFY email_index CHAR(64) NOT NULL');
  const [check] = await pool.execute('SELECT email FROM users LIMIT 1');
  if (check.length) decrypt(check[0].email, 'email');
}
module.exports = { PASSWORD_RULE, validPassword, hashPassword, verifyPassword, encrypt, decrypt, keyedDigest, emailIndex, userData, migrateAccounts };
