const logger = require('../utils/logger');

function getPool() {
  return require('../services/database').getPool();
}

// ─── getUserByEmail ───────────────────────────────────────────────────────────
async function getUserByEmail(email) {
  const pool = getPool();
  if (!pool) {
    logger.warn('getUserByEmail: banco indisponível');
    return null;
  }

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    return result.rows[0] || null;
  } catch (err) {
    logger.error(`getUserByEmail error: ${err.message}`);
    return null;
  }
}

// ─── getUserById ──────────────────────────────────────────────────────────────
async function getUserById(id) {
  const pool = getPool();
  if (!pool) {
    logger.warn('getUserById: banco indisponível');
    return null;
  }

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  } catch (err) {
    logger.error(`getUserById error: ${err.message}`);
    return null;
  }
}

// ─── createUser ───────────────────────────────────────────────────────────────
async function createUser(email, passwordHash, role = 'viewer') {
  const pool = getPool();
  if (!pool) {
    logger.warn('createUser: banco indisponível');
    return null;
  }

  try {
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [email, passwordHash, role]
    );
    const user = result.rows[0];
    logger.info(`Usuário criado: id=${user.id} email=${user.email} role=${user.role}`);
    return user;
  } catch (err) {
    logger.error(`createUser error: ${err.message}`);
    return null;
  }
}

// ─── updateLastLogin ──────────────────────────────────────────────────────────
async function updateLastLogin(userId) {
  const pool = getPool();
  if (!pool) {
    logger.warn('updateLastLogin: banco indisponível');
    return null;
  }

  try {
    const result = await pool.query(
      `UPDATE users SET last_login = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING id, email, last_login`,
      [userId]
    );
    return result.rows[0] || null;
  } catch (err) {
    logger.error(`updateLastLogin error: ${err.message}`);
    return null;
  }
}

// ─── listUsers ────────────────────────────────────────────────────────────────
// Retorna todos os usuários sem expor password_hash.
async function listUsers() {
  const pool = getPool();
  if (!pool) {
    logger.warn('listUsers: banco indisponível');
    return [];
  }

  try {
    const result = await pool.query(
      'SELECT id, email, role, created_at, updated_at, last_login FROM users ORDER BY created_at DESC'
    );
    return result.rows;
  } catch (err) {
    logger.error(`listUsers error: ${err.message}`);
    return [];
  }
}

// ─── deleteUser ───────────────────────────────────────────────────────────────
// Hard delete: remove o registro permanentemente.
async function deleteUser(userId) {
  const pool = getPool();
  if (!pool) {
    logger.warn('deleteUser: banco indisponível');
    return null;
  }

  try {
    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING id, email',
      [userId]
    );
    const deleted = result.rows[0] || null;
    if (deleted) {
      logger.info(`Usuário removido: id=${deleted.id} email=${deleted.email}`);
    }
    return deleted;
  } catch (err) {
    logger.error(`deleteUser error: ${err.message}`);
    return null;
  }
}

module.exports = {
  getUserByEmail,
  getUserById,
  createUser,
  updateLastLogin,
  listUsers,
  deleteUser,
};
