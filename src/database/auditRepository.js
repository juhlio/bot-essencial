const logger = require('../utils/logger');

function getPool() {
  return require('../services/database').getPool();
}

// ─── logAccess ────────────────────────────────────────────────────────────────
async function logAccess(userId, action, ipAddress) {
  const pool = getPool();
  if (!pool) {
    logger.warn('logAccess: banco indisponível');
    return null;
  }

  try {
    const result = await pool.query(
      `INSERT INTO audit_logs (user_id, action, ip_address)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, action, ipAddress]
    );
    const row = result.rows[0];
    logger.info(`Audit log: user_id=${userId} action=${action} ip=${ipAddress}`);
    return row;
  } catch (err) {
    logger.error(`logAccess error: ${err.message}`);
    return null;
  }
}

// ─── getAccessLogs ────────────────────────────────────────────────────────────
async function getAccessLogs(userId, limit = 100) {
  const pool = getPool();
  if (!pool) {
    logger.warn('getAccessLogs: banco indisponível');
    return [];
  }

  try {
    const result = await pool.query(
      `SELECT * FROM audit_logs
       WHERE user_id = $1
       ORDER BY timestamp DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  } catch (err) {
    logger.error(`getAccessLogs error: ${err.message}`);
    return [];
  }
}

// ─── getAllAccessLogs ─────────────────────────────────────────────────────────
async function getAllAccessLogs(limit = 500, offset = 0) {
  const pool = getPool();
  if (!pool) {
    logger.warn('getAllAccessLogs: banco indisponível');
    return [];
  }

  try {
    const result = await pool.query(
      `SELECT * FROM audit_logs
       ORDER BY timestamp DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows;
  } catch (err) {
    logger.error(`getAllAccessLogs error: ${err.message}`);
    return [];
  }
}

module.exports = { logAccess, getAccessLogs, getAllAccessLogs };
