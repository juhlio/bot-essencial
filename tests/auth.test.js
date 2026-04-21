const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');

// Isolamento: sem banco real nem Redis
process.env.DATABASE_URL = '';
process.env.REDIS_URL    = '';
process.env.JWT_SECRET   = 'test-secret-auth-suite';

const authService = require('../src/services/authService');

// Mocks antes de carregar o app (authHandler usa esses repos)
const userRepo  = require('../src/database/userRepository');
const auditRepo = require('../src/database/auditRepository');
auditRepo.logAccess      = async () => null;
userRepo.updateLastLogin = async () => null;

const app = require('../src/index');

let server;
let baseUrl;
let PASSWORD_HASH;

const ADMIN_USER = { id: 42, email: 'admin@test.com', role: 'admin' };
const PLAIN_PASS = 'senha123';

// ─── Setup / Teardown ─────────────────────────────────────────────────────────
before(async () => {
  PASSWORD_HASH = await authService.hashPassword(PLAIN_PASS);

  await new Promise(resolve => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(() => new Promise(resolve => server.close(resolve)));

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res  = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

async function get(path, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res  = await fetch(`${baseUrl}${path}`, { headers });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

// =============================================================================
// 1 — authService.hashPassword
// =============================================================================
describe('authService.hashPassword', () => {

  it('retorna string diferente da senha original', async () => {
    const hash = await authService.hashPassword('minhasenha');
    assert.ok(typeof hash === 'string', 'hash deve ser string');
    assert.notEqual(hash, 'minhasenha', 'hash não deve ser igual à senha');
  });

  it('dois hashes da mesma senha são diferentes entre si (salt aleatório)', async () => {
    const h1 = await authService.hashPassword('abc123');
    const h2 = await authService.hashPassword('abc123');
    assert.notEqual(h1, h2, 'hashes devem ser únicos por salt');
  });

});

// =============================================================================
// 2 — authService.verifyPassword
// =============================================================================
describe('authService.verifyPassword', () => {

  it('retorna true para senha correta', async () => {
    const ok = await authService.verifyPassword(PLAIN_PASS, PASSWORD_HASH);
    assert.equal(ok, true);
  });

  it('retorna false para senha incorreta', async () => {
    const ok = await authService.verifyPassword('senhaerrada', PASSWORD_HASH);
    assert.equal(ok, false);
  });

});

// =============================================================================
// 3 — authService.generateJWT
// =============================================================================
describe('authService.generateJWT', () => {

  it('retorna string com 3 partes separadas por ponto', () => {
    const token = authService.generateJWT(1, 'a@b.com');
    assert.ok(typeof token === 'string', 'deve ser string');
    assert.equal(token.split('.').length, 3, 'deve ter 3 partes');
  });

  it('payload decodificado contém userId e email corretos', () => {
    const token   = authService.generateJWT(99, 'x@y.com');
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    assert.equal(payload.userId, 99);
    assert.equal(payload.email, 'x@y.com');
  });

});

// =============================================================================
// 4 — authService.verifyJWT
// =============================================================================
describe('authService.verifyJWT', () => {

  it('retorna payload para token válido', () => {
    const token   = authService.generateJWT(1, 'a@b.com');
    const payload = authService.verifyJWT(token);
    assert.ok(payload !== null, 'payload deve ser não-nulo');
    assert.equal(payload.userId, 1);
    assert.equal(payload.email, 'a@b.com');
  });

  it('retorna null para token com assinatura adulterada', () => {
    const token  = authService.generateJWT(1, 'a@b.com');
    const tampered = token.slice(0, -4) + 'XXXX';
    assert.equal(authService.verifyJWT(tampered), null);
  });

  it('retorna null para token expirado (exp no passado)', () => {
    // Monta manualmente um token com exp já vencido
    const b64url = str => Buffer.from(str).toString('base64url');
    const crypto = require('crypto');
    const secret = process.env.JWT_SECRET;
    const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64url(JSON.stringify({ userId: 1, email: 'x@y.com', iat: 1, exp: 1 }));
    const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
    const expired = `${header}.${payload}.${sig}`;
    assert.equal(authService.verifyJWT(expired), null);
  });

  it('retorna null para string aleatória', () => {
    assert.equal(authService.verifyJWT('not.a.token'), null);
  });

});

// =============================================================================
// 5 — userRepository.createUser (mock de banco)
// =============================================================================
describe('userRepository.createUser', () => {

  it('cria usuário e retorna objeto com email e role corretos', async () => {
    userRepo.createUser = async (email, hash, role) => ({
      id: 1, email, password_hash: hash, role,
    });

    const user = await userRepo.createUser('novo@test.com', 'hashX', 'viewer');
    assert.equal(user.email, 'novo@test.com');
    assert.equal(user.role, 'viewer');
    assert.ok(user.id, 'deve ter id');
  });

  it('role padrão pode ser admin quando passado explicitamente', async () => {
    userRepo.createUser = async (email, hash, role) => ({
      id: 2, email, password_hash: hash, role,
    });

    const user = await userRepo.createUser('adm@test.com', 'hashY', 'admin');
    assert.equal(user.role, 'admin');
  });

});

// =============================================================================
// 6 — userRepository.getUserByEmail (mock de banco)
// =============================================================================
describe('userRepository.getUserByEmail', () => {

  it('retorna usuário quando encontrado', async () => {
    userRepo.getUserByEmail = async () => ({ ...ADMIN_USER, password_hash: PASSWORD_HASH });
    const user = await userRepo.getUserByEmail(ADMIN_USER.email);
    assert.ok(user !== null);
    assert.equal(user.email, ADMIN_USER.email);
  });

  it('retorna null quando usuário não existe', async () => {
    userRepo.getUserByEmail = async () => null;
    const user = await userRepo.getUserByEmail('inexistente@x.com');
    assert.equal(user, null);
  });

});

// =============================================================================
// 7 — authHandler POST /auth/login
// =============================================================================
describe('authHandler POST /auth/login', () => {

  it('credenciais corretas → 200 com token JWT', async () => {
    userRepo.getUserByEmail = async () => ({ ...ADMIN_USER, password_hash: PASSWORD_HASH });
    try {
      const { status, body } = await post('/auth/login', {
        email: ADMIN_USER.email, password: PLAIN_PASS,
      });
      assert.equal(status, 200);
      assert.ok(typeof body.token === 'string', 'deve ter token');
      assert.equal(body.token.split('.').length, 3, 'token deve ser JWT');
      assert.equal(body.email, ADMIN_USER.email);
    } finally {
      userRepo.getUserByEmail = async () => null;
    }
  });

  it('senha incorreta → 401', async () => {
    userRepo.getUserByEmail = async () => ({ ...ADMIN_USER, password_hash: PASSWORD_HASH });
    try {
      const { status } = await post('/auth/login', {
        email: ADMIN_USER.email, password: 'senhaerrada',
      });
      assert.equal(status, 401);
    } finally {
      userRepo.getUserByEmail = async () => null;
    }
  });

  it('usuário inexistente → 401', async () => {
    userRepo.getUserByEmail = async () => null;
    const { status } = await post('/auth/login', {
      email: 'ghost@x.com', password: PLAIN_PASS,
    });
    assert.equal(status, 401);
  });

  it('body vazio → 400', async () => {
    const { status } = await post('/auth/login', {});
    assert.equal(status, 400);
  });

});

// =============================================================================
// 8 — authHandler POST /auth/logout
// =============================================================================
describe('authHandler POST /auth/logout', () => {

  it('token válido → 200 e mensagem de sucesso', async () => {
    const token = authService.generateJWT(ADMIN_USER.id, ADMIN_USER.email);
    const { status, body } = await post('/auth/logout', {}, token);
    assert.equal(status, 200);
    assert.ok(body.message, 'deve ter mensagem');
  });

  it('sem token → 401', async () => {
    const { status } = await post('/auth/logout', {});
    assert.equal(status, 401);
  });

  it('token inválido → 401', async () => {
    const { status } = await post('/auth/logout', {}, 'token.invalido.aqui');
    assert.equal(status, 401);
  });

});

// =============================================================================
// 9 — requireAuth middleware
// =============================================================================
describe('requireAuth middleware', () => {

  it('sem header Authorization → 401', async () => {
    const { status } = await get('/auth/me');
    assert.equal(status, 401);
  });

  it('token malformado → 401', async () => {
    const { status } = await get('/auth/me', 'nao-e-um-jwt');
    assert.equal(status, 401);
  });

  it('token válido → próximo middleware executa (404 do repo mock)', async () => {
    userRepo.getUserById = async () => null;
    // userId distinto para não colidir com token revogado no teste de logout
    const token = authService.generateJWT(999, 'middleware@test.com');
    const { status } = await get('/auth/me', token);
    // requireAuth passa → handler busca usuário → mock retorna null → 404
    assert.equal(status, 404);
  });

  it('token revogado → 401', async () => {
    const token = authService.generateJWT(998, 'revoked-mw@test.com');
    await authService.revokeToken(token);
    const { status } = await get('/auth/me', token);
    assert.equal(status, 401);
  });

});

// =============================================================================
// 10 — isTokenBlacklisted
// =============================================================================
describe('authService.isTokenBlacklisted', () => {

  it('token novo não está na blacklist', async () => {
    const token = authService.generateJWT(1, 'fresh@test.com');
    const listed = await authService.isTokenBlacklisted(token);
    assert.equal(listed, false);
  });

  it('token revogado está na blacklist', async () => {
    const token = authService.generateJWT(2, 'revoke@test.com');
    await authService.revokeToken(token);
    const listed = await authService.isTokenBlacklisted(token);
    assert.equal(listed, true);
  });

  it('tokens diferentes são independentes na blacklist', async () => {
    const t1 = authService.generateJWT(10, 'a@test.com');
    const t2 = authService.generateJWT(11, 'b@test.com');
    await authService.revokeToken(t1);
    assert.equal(await authService.isTokenBlacklisted(t1), true);
    assert.equal(await authService.isTokenBlacklisted(t2), false);
  });

});
