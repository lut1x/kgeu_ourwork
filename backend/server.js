const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2/promise');
const { installAuth } = require('./auth');
const fs = require('node:fs');
const path = require('node:path');
const { migrateAccounts } = require('./security');
const { installTelemetry, migrateTelemetry } = require('./telemetry');
const { installCollectors, migrateCollectors } = require('./collectors');
const { installCommunicationStatus } = require('./communication');

const app = express();
// One nginx reverse proxy; it appends the actual client address to X-Forwarded-For.
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false }
});

app.use(express.json({ limit: '16kb' }));

// ── MySQL Connection Pool ──────────────────────────────────────────
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'mysql',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'techmonitor',
  database: process.env.DB_NAME || 'techmonitor',
  timezone: 'Z',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const access = installAuth(app, io, pool);
const { broadcast } = installTelemetry(app, io, pool, access);
installCollectors(app, pool, access, broadcast, io);
installCommunicationStatus(app, pool, access.requireUser);

// Wait for MySQL to be ready
async function waitForDB(retries = 30, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      const conn = await pool.getConnection();
      conn.release();
      console.log('✅ Connected to MySQL');
      return;
    } catch (err) {
      console.log(`⏳ Waiting for MySQL... (${i + 1}/${retries})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('❌ Could not connect to MySQL');
}

// ── WebSocket ──────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

// ── Health check ──────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Start Server ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

app.use((err, req, res, next) => {
  console.error('Request failed:', err.code || err.status || 'INTERNAL');
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Ошибка сервера' });
});

waitForDB().then(async () => {
  const schema = fs.readFileSync(path.join(__dirname, 'auth.sql'), 'utf8');
  for (const statement of schema.split(';').filter(s => s.trim())) await pool.query(statement);
  await migrateAccounts(pool);
  await migrateTelemetry(pool);
  await migrateCollectors(pool);
  setInterval(() => pool.execute('DELETE FROM email_challenges WHERE expires_at<=NOW()').catch(() => {}), 60000).unref();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Backend server running on port ${PORT}`);
  });
}).catch(err => {
  console.error(err.message);
  process.exit(1);
});

