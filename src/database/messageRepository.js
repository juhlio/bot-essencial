const logger = require('../utils/logger');
const { SEED_MESSAGES } = require('./seedMessages');

// ── Cache em memória ──────────────────────────────────────────────────────────
const _cache = new Map();          // Map<key, template>
let _cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

function _isCacheStale() {
  return Date.now() - _cacheTime > CACHE_TTL_MS;
}

function invalidateCache() {
  _cache.clear();
  _cacheTime = 0;
}

function _setCache(templates) {
  _cache.clear();
  for (const t of templates) _cache.set(t.key, t);
  _cacheTime = Date.now();
}

async function _fetchAllFromDb() {
  const { getPool } = require('../services/database');
  const pool = getPool();
  if (!pool) return null;

  try {
    const result = await pool.query(
      'SELECT * FROM message_templates ORDER BY category, key'
    );
    return result.rows;
  } catch (err) {
    logger.error(`messageRepository._fetchAllFromDb: ${err.message}`);
    return null;
  }
}

async function _ensureCache() {
  if (_cache.size > 0 && !_isCacheStale()) return;
  const rows = await _fetchAllFromDb();
  if (rows) _setCache(rows);
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

async function getAllMessages() {
  await _ensureCache();
  return Array.from(_cache.values());
}

async function getMessageByKey(key) {
  await _ensureCache();
  return _cache.get(key) || null;
}

async function updateMessage(key, content, updatedBy = 'api') {
  const { getPool } = require('../services/database');
  const pool = getPool();
  if (!pool) throw new Error('Banco indisponível');

  const result = await pool.query(
    `UPDATE message_templates
     SET content = $1, updated_by = $2, updated_at = NOW()
     WHERE key = $3
     RETURNING *`,
    [content, updatedBy, key]
  );

  if (!result.rows[0]) throw new Error(`Template não encontrado: ${key}`);

  _cache.set(key, result.rows[0]);
  logger.info(`messageRepository.updateMessage: key=${key} by=${updatedBy}`);
  return result.rows[0];
}

async function resetMessage(key) {
  const seed = SEED_MESSAGES.find(m => m.key === key);
  if (!seed) throw new Error(`Seed não encontrado: ${key}`);
  return updateMessage(key, seed.content, 'system');
}

async function resetAllMessages() {
  const results = [];
  for (const seed of SEED_MESSAGES) {
    try {
      results.push(await updateMessage(seed.key, seed.content, 'system'));
    } catch (err) {
      logger.warn(`resetAllMessages: falha em key=${seed.key} — ${err.message}`);
    }
  }
  return results;
}

// ── Resolução de variáveis ─────────────────────────────────────────────────────
// Retorna a string final com {{variavel}} substituídas, ou null se key não existe.
// Fallback para messages.js é responsabilidade de getMessage() em utils/messages.js.

async function resolveMessage(key, variables = {}) {
  await _ensureCache();
  const template = _cache.get(key);
  if (!template) return null;

  if (!template.is_dynamic || !Object.keys(variables).length) {
    return template.content;
  }

  let result = template.content;
  for (const [varName, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${varName}\\}\\}`, 'g'), value ?? '');
  }
  return result;
}

module.exports = {
  getAllMessages,
  getMessageByKey,
  updateMessage,
  resetMessage,
  resetAllMessages,
  invalidateCache,
  resolveMessage,
};
