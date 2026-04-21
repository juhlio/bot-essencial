const authService = require('../services/authService');
const logger      = require('../utils/logger');

// Retorna true quando o cliente espera JSON (requisição AJAX / API).
function isAjax(req) {
  const accept = req.headers['accept'] || '';
  return accept.includes('application/json');
}

// Responde com 401: JSON para AJAX, redirect para /login para navegador.
function unauthorized(req, res, reason) {
  logger.warn(`authMiddleware: acesso negado — ${reason} [${req.method} ${req.originalUrl}]`);
  if (isAjax(req)) {
    return res.status(401).json({ error: 'Unauthorized', reason });
  }
  return res.redirect(401, '/login');
}

// ─── requireAuth ──────────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token      = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null;

  if (!token) {
    return unauthorized(req, res, 'token ausente');
  }

  const payload = authService.verifyJWT(token);
  if (!payload) {
    return unauthorized(req, res, 'token inválido ou expirado');
  }

  const blacklisted = await authService.isTokenBlacklisted(token);
  if (blacklisted) {
    return unauthorized(req, res, 'token revogado');
  }

  req.user = { userId: payload.userId, email: payload.email };
  logger.info(`authMiddleware: acesso autorizado — userId=${payload.userId} [${req.method} ${req.originalUrl}]`);
  return next();
}

module.exports = { requireAuth };
