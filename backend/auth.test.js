const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
process.env.ACCOUNT_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
const { hashPassword, verifyPassword, validPassword, encrypt, decrypt, emailIndex, keyedDigest } = require('./security');
test('password policy rejects missing complexity and short passwords', () => {
  for (const password of ['Short1!', 'longpassword1!', 'LONGPASSWORD1!', 'LongPassword!!', 'LongPassword123', 'Long Password1!']) assert.equal(validPassword(password), false, password);
  assert.equal(validPassword('StrongPassword12!'), true);
  assert.equal(validPassword('НадежныйПароль12!'), true);
});
test('Argon2id hashes have unique salts, verify, and support legacy scrypt', async () => {
  const password = 'StrongPassword12!';
  const a = await hashPassword(password); const b = await hashPassword(password);
  assert.match(a, /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/); assert.notEqual(a, b);
  assert.equal(await verifyPassword(password, a), true); assert.equal(await verifyPassword('wrong', a), false);
  const salt = crypto.randomBytes(16).toString('hex');
  const legacy = `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
  assert.equal(await verifyPassword(password, legacy), true);
});
test('AES-GCM hides data, uses unique IVs and rejects tampering or wrong context', () => {
  const email = 'operator@gmail.com'; const a = encrypt(email, 'email'); const b = encrypt(email, 'email');
  assert.notEqual(a, b); assert.equal(a.includes(email), false); assert.equal(decrypt(a, 'email'), email);
  assert.throws(() => decrypt(a, 'first_name'));
  const data = Buffer.from(a.slice(3), 'base64'); data[28] ^= 1;
  assert.throws(() => decrypt(`v1:${data.toString('base64')}`, 'email'));
  assert.equal(emailIndex(email), emailIndex(' OPERATOR@gmail.com '));
  assert.notEqual(emailIndex(email), keyedDigest(email, 'email-code'));
});
