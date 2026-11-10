const mysql = require('mysql2/promise');
const { hashPassword, validPassword, PASSWORD_RULE, encrypt, emailIndex } = require('./security');
async function main() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_FIRST_NAME = 'Администратор', ADMIN_LAST_NAME = 'Системы' } = process.env;
  if (!ADMIN_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ADMIN_EMAIL) || ADMIN_EMAIL.length > 254 || !validPassword(ADMIN_PASSWORD)) throw new Error(`Укажите ADMIN_EMAIL и ADMIN_PASSWORD: ${PASSWORD_RULE}`);
  const conn = await mysql.createConnection({ host: process.env.DB_HOST || 'mysql', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || 'techmonitor', database: process.env.DB_NAME || 'techmonitor' });
  try {
    const email = ADMIN_EMAIL.trim().toLowerCase();
    await conn.execute("INSERT INTO users (email,email_index,first_name,last_name,role,password_hash) VALUES (?,?,?,?,'administrator',?)", [encrypt(email, 'email'), emailIndex(email), encrypt(ADMIN_FIRST_NAME, 'first_name'), encrypt(ADMIN_LAST_NAME, 'last_name'), await hashPassword(ADMIN_PASSWORD)]);
    console.log('Учетная запись администратора создана');
  } finally { await conn.end(); }
}
main().catch(err => { console.error(err.code === 'ER_DUP_ENTRY' ? 'Почта уже существует. Используйте другую почту.' : err.message); process.exitCode = 1; });
