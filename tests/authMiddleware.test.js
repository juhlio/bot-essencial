const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

delete process.env.JWT_SECRET;
delete process.env.REDIS_URL;

const { requireAuth }  = require('../src/middleware/authMiddleware');
const authService      = require('../src/services/authService');

// ─── Helpers: objetos req/res mínimos ────────────────────────────────────────
function makeReq({ authorization, accept } = {}) {
  return {
    method:      'GET',
    originalUrl: '/api/protected',
    headers: {
      ...(authorization && { authorization }),
      ...(accept        && { accept }),
    },
  };
}

function makeRes() {
  const res = {
    _status:   null,
    _body:     null,
    _redirect: null,
    status(code) { this._status = code; return this; },
    json(body)   { this._body   = body; return this; },
    redirect(code, url) {
      this._status   = code;
      this._redirect = url;
      return this;
    },
  };
  return res;
}

// =============================================================================
// Suite 1 — Bloqueio: token ausente / inválido / revogado
// =============================================================================
describe('authMiddleware — bloqueio de acesso', () => {

  it('sem header Authorization → 401 redirect para /login', async () => {
    const req  = makeReq();
    const res  = makeRes();
    let called = false;
    await requireAuth(req, res, () => { called = true; });

    assert.equal(called,        false);
    assert.equal(res._status,   401);
    assert.equal(res._redirect, '/login');
  });

  it('header Authorization sem Bearer → 401 redirect para /login', async () => {
    const req  = makeReq({ authorization: 'Basic dXNlcjpwYXNz' });
    const res  = makeRes();
    let called = false;
    await requireAuth(req, res, () => { called = true; });

    assert.equal(called,        false);
    assert.equal(res._status,   401);
    assert.equal(res._redirect, '/login');
  });

  it('token inválido (string aleatória) → 401 redirect para /login', async () => {
    const req  = makeReq({ authorization: 'Bearer token.invalido.aqui' });
    const res  = makeRes();
    let called = false;
    await requireAuth(req, res, () => { called = true; });

    assert.equal(called,        false);
    assert.equal(res._status,   401);
    assert.equal(res._redirect, '/login');
  });

  it('token revogado → 401 redirect para /login', async () => {
    const token = authService.generateJWT(99, 'revogado@test.com');
    await authService.revokeToken(token);

    const req  = makeReq({ authorization: `Bearer ${token}` });
    const res  = makeRes();
    let called = false;
    await requireAuth(req, res, () => { called = true; });

    assert.equal(called,        false);
    assert.equal(res._status,   401);
    assert.equal(res._redirect, '/login');
  });

});

// =============================================================================
// Suite 2 — Resposta JSON para requisições AJAX (Accept: application/json)
// =============================================================================
describe('authMiddleware — resposta JSON para AJAX', () => {

  it('sem token + Accept JSON → 401 JSON (sem redirect)', async () => {
    const req  = makeReq({ accept: 'application/json' });
    const res  = makeRes();
    await requireAuth(req, res, () => {});

    assert.equal(res._status,   401);
    assert.equal(res._redirect, null, 'não deve redirecionar');
    assert.ok(res._body,               'deve retornar body JSON');
    assert.equal(res._body.error, 'Unauthorized');
  });

  it('token inválido + Accept JSON → 401 JSON com campo reason', async () => {
    const req  = makeReq({ authorization: 'Bearer xxx.yyy.zzz', accept: 'application/json' });
    const res  = makeRes();
    await requireAuth(req, res, () => {});

    assert.equal(res._status, 401);
    assert.ok(res._body.reason, 'deve incluir campo reason');
  });

});

// =============================================================================
// Suite 3 — Acesso autorizado: token válido
// =============================================================================
describe('authMiddleware — acesso autorizado', () => {

  it('token válido → chama next() e popula req.user', async () => {
    const token = authService.generateJWT(7, 'julio@essencial.com');
    const req   = makeReq({ authorization: `Bearer ${token}` });
    const res   = makeRes();
    let called  = false;
    await requireAuth(req, res, () => { called = true; });

    assert.equal(called,          true,                  'next() deve ser chamado');
    assert.equal(res._status,     null,                  'não deve setar status');
    assert.equal(req.user.userId, 7,                     'userId correto');
    assert.equal(req.user.email,  'julio@essencial.com', 'email correto');
  });

  it('req.user contém apenas userId e email (sem password_hash nem outros campos)', async () => {
    const token = authService.generateJWT(8, 'test@test.com');
    const req   = makeReq({ authorization: `Bearer ${token}` });
    const res   = makeRes();
    await requireAuth(req, res, () => {});

    assert.ok('userId' in req.user, 'userId presente');
    assert.ok('email'  in req.user, 'email presente');
    assert.ok(!('iat'  in req.user), 'iat não deve vazar para req.user');
    assert.ok(!('exp'  in req.user), 'exp não deve vazar para req.user');
  });

  it('requisição AJAX com token válido → chama next() sem alterar res', async () => {
    const token = authService.generateJWT(9, 'ajax@test.com');
    const req   = makeReq({ authorization: `Bearer ${token}`, accept: 'application/json' });
    const res   = makeRes();
    let called  = false;
    await requireAuth(req, res, () => { called = true; });

    assert.equal(called,      true);
    assert.equal(res._status, null);
    assert.equal(res._body,   null);
  });

});
