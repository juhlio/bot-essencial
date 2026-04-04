const logger = require('../utils/logger');

if (!process.env.DATABASE_URL) {
  logger.warn('DATABASE_URL não configurada — módulo de banco desativado');
  module.exports = {
    getPool: () => null,
    query: async () => { throw new Error('Banco de dados não configurado'); },
    close: async () => {},
  };
  return;
}

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('connect', () => {
  logger.info('PostgreSQL: nova conexão estabelecida');
});

pool.on('error', (err) => {
  logger.error(`PostgreSQL: erro no pool de conexões: ${err.message}`);
});

// Testa a conexão ao inicializar
pool.query('SELECT 1')
  .then(() => logger.info('PostgreSQL conectado com sucesso'))
  .catch((err) => logger.error(`PostgreSQL: falha na conexão inicial: ${err.message}`));

function getPool() {
  return pool;
}

async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    logger.info(`PostgreSQL query (${Date.now() - start}ms): ${text.slice(0, 80)}`);
    return result;
  } catch (err) {
    logger.error(`PostgreSQL query error: ${err.message} | query: ${text.slice(0, 80)}`);
    throw err;
  }
}

async function close() {
  await pool.end();
  logger.info('PostgreSQL: pool encerrado');
}

module.exports = { getPool, query, close };
