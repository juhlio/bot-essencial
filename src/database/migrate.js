const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    logger.warn('migrate: DATABASE_URL não definida — migrações ignoradas');
    return;
  }

  const { getPool } = require('../services/database');
  const pool = getPool();

  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    logger.info('Migrações executadas com sucesso');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`Falha nas migrações: ${err.message}`);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { runMigrations };

if (require.main === module) {
  require('dotenv').config();
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
