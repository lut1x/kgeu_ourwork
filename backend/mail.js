const nodemailer = require('nodemailer');
const dns = require('node:dns').promises;
async function mailDomainExists(email) {
  const domain = email.split('@')[1];
  if (/\.(invalid|localhost|test|example)$/.test(domain)) return false;
  try {
    const records = await dns.resolveMx(domain);
    if (records.length) return records.some(record => record.exchange && record.exchange !== '.');
  } catch (err) {
    if (err.code === 'ENOTFOUND') return false;
    if (err.code !== 'ENODATA') throw Object.assign(new Error('Не удалось проверить почтовый домен. Повторите позже'), { status: 503 });
  }
  const results = await Promise.allSettled([dns.resolve4(domain), dns.resolve6(domain)]);
  if (results.some(r => r.status === 'fulfilled' && r.value.length)) return true;
  if (results.some(r => r.status === 'rejected' && !['ENOTFOUND', 'ENODATA'].includes(r.reason.code))) throw Object.assign(new Error('Не удалось проверить почтовый домен. Повторите позже'), { status: 503 });
  return false;
}
async function sendCode(email, code, purpose, id) {
  const local = process.env.MAIL_MODE === 'local';
  if (!process.env.SMTP_HOST) throw Object.assign(new Error('Почтовый сервер не настроен'), { status: 503 });
  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465,
    requireTLS: !local && port !== 465,
    ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } } : {}),
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  });
  const resetting = purpose === 'reset';
  const url = new URL(process.env.APP_URL || 'http://localhost');
  if (resetting) url.searchParams.set('reset', id);
  try {
    await transport.sendMail({ disableFileAccess: true, disableUrlAccess: true, from: process.env.MAIL_FROM || 'Tech Monitor <noreply@techmonitor.local>', to: email,
      subject: resetting ? 'Tech Monitor — сброс пароля' : 'Tech Monitor — подтверждение почты',
      text: `${resetting ? 'Администратор инициировал сброс вашего пароля.' : 'Подтвердите почту для завершения регистрации.'}\nКод: ${code}\nКод действует 10 минут, не более 5 попыток.\n${resetting ? `Установите новый пароль: ${url.toString()}` : 'Введите код в открытой форме регистрации.'}\nЕсли вы не ожидали это письмо, не используйте код.`,
    });
  } catch { throw Object.assign(new Error('Не удалось отправить письмо. Повторите позже'), { status: 503 }); }
}
module.exports = { mailDomainExists, sendCode };
