const TIMEOUT_MS = 60000;

function communicationStatus(collectors, now = Date.now()) {
  const enabled = collectors.filter(c => c.enabled);
  let online = 0, errors = 0;
  for (const collector of enabled) {
    const seen = collector.last_seen ? new Date(collector.last_seen).getTime() : NaN;
    if (collector.enabled && Number.isFinite(seen) && seen <= now && now - seen < TIMEOUT_MS) {
      online++;
      if (collector.status_json?.error) errors++;
    }
  }
  const total = enabled.length;
  const unavailable = total - online;
  return { state: !collectors.length ? 'empty' : !total ? 'disabled' : unavailable || errors ? 'error' : 'active', total, online, unavailable, errors,
    registered_total: collectors.length, disabled: collectors.length - total,
    timeout_seconds: TIMEOUT_MS / 1000, checked_at: new Date(now).toISOString() };
}

function installCommunicationStatus(app, pool, requireUser) {
  // Aggregate only: no device names, tokens, ports or channel permissions exposed.
  app.get('/api/communication-status', requireUser, async (req, res, next) => {
    try {
      const [rows] = await pool.execute('SELECT enabled,last_seen,status_json FROM collectors');
      res.set('Cache-Control', 'no-store');
      res.json(communicationStatus(rows));
    } catch (error) { next(error); }
  });
}

module.exports = { communicationStatus, installCommunicationStatus };
