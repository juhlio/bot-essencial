const logger = require('../utils/logger');

async function saveMessageToHistory(from, message, sender = 'client') {
  const { getPool } = require('../services/database');
  const pool = getPool();
  if (!pool) {
    logger.warn('saveMessageToHistory: banco indisponível, mensagem não salva');
    return null;
  }
  try {
    const result = await pool.query(
      `INSERT INTO message_history (phone_from, message_text, sender)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [from, message, sender]
    );
    logger.info(`Mensagem salva no histórico [${sender}] de ${from}`);
    return result.rows[0];
  } catch (err) {
    logger.error(`saveMessageToHistory error: ${err.message}`);
    return null;
  }
}

module.exports = { saveMessageToHistory };
