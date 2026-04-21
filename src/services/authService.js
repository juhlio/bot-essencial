const crypto = require('crypto');
const bcrypt  = require('bcryptjs');
const logger  = require('../utils/logger');

// ─── Configuração ─────────────────────────────────────────────────────────────
// JWT_SECRET deve estar no .env. Se ausente, gera um aleatório por sessão
// (tokens não sobreviverão a restarts do processo nesse caso).
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL  = 86400; // 24 h em segundos

// ─── Blacklist: Redis com fallback em Map ─────────────────────────────────────
// Reutiliza ioredis (já dependência do projeto). Se REDIS_URL não estiver
// configurada ou o Redis cair, usa Map em memória — mesma estratégia do
// redisSessionStore.js.
let _redisClient = null;
const _memBlacklist = new Map(); // fallback: token_hash → expiry (timestamp ms)

function getRedis() {
  if (_redisClient) return _redisClient;
  if (!process.env.REDIS_URL) return null;

  const Redis = require('ioredis');
  _redisClient = new Redis(process.env.REDIS_URL, {
    lazyConnect:          true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue:   false,
  });
  _redisClient.on('error', (err) => {
    logger.error(`authService Redis error: ${err.message}`);
  });
  return _redisClient;
}

// Deriva uma chave curta e segura para o token (evita chaves muito longas no Redis)
function tokenKey(token) {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return `blacklist:${hash}`;
}

// ─── Base64url helpers ────────────────────────────────────────────────────────
// Usa Buffer nativo — sem dependência externa para codificação JWT.
function b64url(str) {
  return Buffer.from(str).toString('base64url');
}

function b64urlDecode(str) {
  return Buffer.from(str, 'base64url').toString('utf8');
}

// ─── 1. hashPassword ──────────────────────────────────────────────────────────
async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

// ─── 2. verifyPassword ────────────────────────────────────────────────────────
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// ─── 3. generateJWT ──────────────────────────────────────────────────────────
// Constrói um JWT HS256 manualmente com Buffer/crypto — sem lib externa.
function generateJWT(userId, email) {
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    userId,
    email,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL,
  }));
  const sig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

// ─── 4. verifyJWT ─────────────────────────────────────────────────────────────
// Retorna o payload decodificado ou null (assinatura inválida / expirado / malformado).
function verifyJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts;

    // Recomputa a assinatura e compara com timing-safe equal
    const expected = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${payload}`)
      .digest('base64url');

    const sigBuf      = Buffer.from(sig,      'base64url');
    const expectedBuf = Buffer.from(expected, 'base64url');
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

    const data = JSON.parse(b64urlDecode(payload));
    if (data.exp < Math.floor(Date.now() / 1000)) return null;

    return data;
  } catch {
    return null;
  }
}

// ─── 5. isTokenBlacklisted ────────────────────────────────────────────────────
async function isTokenBlacklisted(token) {
  const key    = tokenKey(token);
  const redis  = getRedis();

  if (redis) {
    try {
      const val = await redis.get(key);
      return val !== null;
    } catch (err) {
      logger.error(`isTokenBlacklisted Redis error: ${err.message}`);
      // fallback: consultar Map em memória
    }
  }

  // Fallback: limpa entradas expiradas e verifica
  const now = Date.now();
  if (_memBlacklist.has(key)) {
    if (_memBlacklist.get(key) > now) return true;
    _memBlacklist.delete(key); // expirou
  }
  return false;
}

// ─── 6. revokeToken ──────────────────────────────────────────────────────────
async function revokeToken(token, expiresIn = TOKEN_TTL) {
  const key   = tokenKey(token);
  const redis = getRedis();

  if (redis) {
    try {
      await redis.set(key, '1', 'EX', expiresIn);
      logger.info(`Token revogado (Redis) TTL=${expiresIn}s`);
      return true;
    } catch (err) {
      logger.error(`revokeToken Redis error: ${err.message}`);
      // fallback: guardar em Map
    }
  }

  _memBlacklist.set(key, Date.now() + expiresIn * 1000);
  logger.info(`Token revogado (fallback Map) TTL=${expiresIn}s`);
  return true;
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateJWT,
  verifyJWT,
  isTokenBlacklisted,
  revokeToken,
};
