const nodemailer = require('nodemailer');
const port = Number(process.env.SMTP_PORT || 587);
const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, requireTLS: process.env.MAIL_MODE !== 'local' && port !== 465, auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined, connectionTimeout: 10000, socketTimeout: 15000 });
transport.verify().then(() => console.log('SMTP connection and authentication successful')).catch(err => { console.error('SMTP verification failed:', err.code || 'CONNECTION_FAILED'); process.exitCode = 1; });
