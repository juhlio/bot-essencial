const { Router }      = require('express');
const authService     = require('../services/authService');
const userRepository  = require('../database/userRepository');
const auditRepository = require('../database/auditRepository');
const { requireAuth } = require('../middleware/authMiddleware');
const logger          = require('../utils/logger');

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getIP(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// ─── requireAdmin ─────────────────────────────────────────────────────────────
// Deve ser usado após requireAuth. Busca o usuário no banco e verifica o role.
async function requireAdmin(req, res, next) {
  const user = await userRepository.getUserById(req.user.userId);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  req.userRecord = user;
  return next();
}

// ─── POST /auth/login ─────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const ip = getIP(req);

  if (!email || !password) {
    return res.status(400).json({ error: 'email e password são obrigatórios' });
  }
  if (typeof password === 'string' && password.length < 6) {
    return res.status(400).json({ error: 'password deve ter no mínimo 6 caracteres' });
  }

  const user = await userRepository.getUserByEmail(email);
  if (!user) {
    await auditRepository.logAccess(null, `login_failed:${email}`, ip);
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }

  const valid = await authService.verifyPassword(password, user.password_hash);
  if (!valid) {
    await auditRepository.logAccess(user.id, 'login_failed', ip);
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }

  const token = authService.generateJWT(user.id, user.email);
  await userRepository.updateLastLogin(user.id);
  await auditRepository.logAccess(user.id, 'login_success', ip);

  logger.info(`authHandler: login userId=${user.id} ip=${ip}`);
  return res.status(200).json({ token, userId: user.id, email: user.email, role: user.role });
});

// ─── POST /auth/logout ────────────────────────────────────────────────────────
router.post('/logout', requireAuth, async (req, res) => {
  const ip    = getIP(req);
  const token = req.headers['authorization'].slice(7).trim();

  await authService.revokeToken(token);
  await auditRepository.logAccess(req.user.userId, 'logout', ip);

  logger.info(`authHandler: logout userId=${req.user.userId} ip=${ip}`);
  return res.status(200).json({ message: 'Logout successful' });
});

// ─── POST /auth/signup ────────────────────────────────────────────────────────
// Restrito a administradores. Cria um novo usuário no sistema.
router.post('/signup', requireAuth, requireAdmin, async (req, res) => {
  const { email, password, role = 'viewer' } = req.body || {};
  const ip = getIP(req);

  if (!email || !password) {
    return res.status(400).json({ error: 'email e password são obrigatórios' });
  }
  if (typeof password === 'string' && password.length < 6) {
    return res.status(400).json({ error: 'password deve ter no mínimo 6 caracteres' });
  }
  if (!['admin', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'role deve ser "admin" ou "viewer"' });
  }

  const existing = await userRepository.getUserByEmail(email);
  if (existing) {
    return res.status(409).json({ error: 'Email já existe' });
  }

  const hash = await authService.hashPassword(password);
  const user = await userRepository.createUser(email, hash, role);
  if (!user) {
    return res.status(500).json({ error: 'Erro ao criar usuário' });
  }

  await auditRepository.logAccess(req.user.userId, `signup:${email}`, ip);
  logger.info(`authHandler: signup userId=${user.id} por admin=${req.user.userId}`);
  return res.status(201).json({ userId: user.id, email: user.email, role: user.role });
});

// ─── GET /auth/me ─────────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  const user = await userRepository.getUserById(req.user.userId);
  if (!user) {
    return res.status(404).json({ error: 'Usuário não encontrado' });
  }
  return res.status(200).json({ userId: user.id, email: user.email, role: user.role });
});

// ─── GET /auth/users ──────────────────────────────────────────────────────────
// Restrito a administradores. Retorna todos os usuários sem password_hash.
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  const users = await userRepository.listUsers();
  return res.status(200).json(users);
});

module.exports = router;
