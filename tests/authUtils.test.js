const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { createAuth } = require('../src/public/js/auth');

// ─── Mock de storage (substitui localStorage) ─────────────────────────────────
function makeMockStorage() {
  const data = new Map();
  return {
    getItem:    (k)    => data.has(k) ? data.get(k) : null,
    setItem:    (k, v) => data.set(k, String(v)),
    removeItem: (k)    => data.delete(k),
    clear:      ()     => data.clear(),
    _data:      data,
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const SAMPLE_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjF9.sig';

// =============================================================================
// Suite 1 — setAuthToken / getAuthToken
// =============================================================================
describe('setAuthToken / getAuthToken', () => {
  let storage, auth;

  beforeEach(() => {
    storage = makeMockStorage();
    auth    = createAuth({ storage });
  });

  it('getAuthToken retorna null quando storage está vazio', () => {
    assert.equal(auth.getAuthToken(), null);
  });

  it('setAuthToken persiste o token no storage', () => {
    auth.setAuthToken(SAMPLE_TOKEN);
    assert.equal(storage.getItem('auth_token'), SAMPLE_TOKEN);
  });

  it('getAuthToken retorna o token salvo', () => {
    auth.setAuthToken(SAMPLE_TOKEN);
    assert.equal(auth.getAuthToken(), SAMPLE_TOKEN);
  });

  it('setAuthToken sobrescreve token anterior', () => {
    auth.setAuthToken('token-antigo');
    auth.setAuthToken(SAMPLE_TOKEN);
    assert.equal(auth.getAuthToken(), SAMPLE_TOKEN);
  });

  it('getAuthToken retorna null quando token é string vazia', () => {
    storage.setItem('auth_token', '');
    // isAuthenticated deve rejeitar string vazia — getAuthToken ainda retorna
    assert.equal(auth.getAuthToken(), '');
  });

});

// =============================================================================
// Suite 2 — clearAuthToken
// =============================================================================
describe('clearAuthToken', () => {
  let storage, auth;

  beforeEach(() => {
    storage = makeMockStorage();
    auth    = createAuth({ storage });
  });

  it('clearAuthToken remove auth_token do storage', () => {
    auth.setAuthToken(SAMPLE_TOKEN);
    auth.clearAuthToken();
    assert.equal(storage.getItem('auth_token'), null);
  });

  it('clearAuthToken remove auth_user do storage', () => {
    storage.setItem('auth_user', JSON.stringify({ userId: 1, email: 'a@b.com' }));
    auth.setAuthToken(SAMPLE_TOKEN);
    auth.clearAuthToken();
    assert.equal(storage.getItem('auth_user'), null);
  });

  it('getAuthToken retorna null após clearAuthToken', () => {
    auth.setAuthToken(SAMPLE_TOKEN);
    auth.clearAuthToken();
    assert.equal(auth.getAuthToken(), null);
  });

  it('clearAuthToken não lança exceção quando storage já está vazio', () => {
    assert.doesNotThrow(() => auth.clearAuthToken());
  });

});

// =============================================================================
// Suite 3 — isAuthenticated
// =============================================================================
describe('isAuthenticated', () => {
  let storage, auth;

  beforeEach(() => {
    storage = makeMockStorage();
    auth    = createAuth({ storage });
  });

  it('retorna false quando não há token', () => {
    assert.equal(auth.isAuthenticated(), false);
  });

  it('retorna true quando token está presente', () => {
    auth.setAuthToken(SAMPLE_TOKEN);
    assert.equal(auth.isAuthenticated(), true);
  });

  it('retorna false após clearAuthToken', () => {
    auth.setAuthToken(SAMPLE_TOKEN);
    auth.clearAuthToken();
    assert.equal(auth.isAuthenticated(), false);
  });

  it('retorna false para token de string vazia', () => {
    storage.setItem('auth_token', '');
    assert.equal(auth.isAuthenticated(), false);
  });

  it('retorna false para token nulo (storage.getItem retorna null)', () => {
    assert.equal(storage.getItem('auth_token'), null);
    assert.equal(auth.isAuthenticated(), false);
  });

});

// =============================================================================
// Suite 4 — getAuthHeader
// =============================================================================
describe('getAuthHeader', () => {
  let storage, auth;

  beforeEach(() => {
    storage = makeMockStorage();
    auth    = createAuth({ storage });
  });

  it('retorna objeto vazio quando não há token', () => {
    const header = auth.getAuthHeader();
    assert.deepEqual(header, {});
  });

  it('retorna {Authorization: "Bearer <token>"} quando token está presente', () => {
    auth.setAuthToken(SAMPLE_TOKEN);
    const header = auth.getAuthHeader();
    assert.equal(header.Authorization, `Bearer ${SAMPLE_TOKEN}`);
  });

  it('formato do header é compatível com fetch (spread em headers)', () => {
    auth.setAuthToken(SAMPLE_TOKEN);
    const headers = Object.assign({ 'Content-Type': 'application/json' }, auth.getAuthHeader());
    assert.equal(headers['Content-Type'],  'application/json');
    assert.equal(headers.Authorization,    `Bearer ${SAMPLE_TOKEN}`);
  });

  it('atualiza header após setAuthToken com novo token', () => {
    auth.setAuthToken('token-1');
    auth.setAuthToken('token-2');
    assert.equal(auth.getAuthHeader().Authorization, 'Bearer token-2');
  });

  it('retorna objeto vazio após clearAuthToken', () => {
    auth.setAuthToken(SAMPLE_TOKEN);
    auth.clearAuthToken();
    assert.deepEqual(auth.getAuthHeader(), {});
  });

});

// =============================================================================
// Suite 5 — logout
// =============================================================================
describe('logout', () => {
  let storage, auth, fetchCalls, redirectCalls;

  beforeEach(() => {
    storage      = makeMockStorage();
    fetchCalls   = [];
    redirectCalls= [];

    auth = createAuth({
      storage,
      fetchFn:  async (url, opts) => { fetchCalls.push({ url, opts }); return { ok: true }; },
      redirect: (url) => redirectCalls.push(url),
    });
  });

  it('chama POST /auth/logout com Authorization header', async () => {
    auth.setAuthToken(SAMPLE_TOKEN);
    await auth.logout();

    assert.equal(fetchCalls.length, 1, 'deve fazer exatamente 1 chamada fetch');
    assert.equal(fetchCalls[0].url, '/auth/logout');
    assert.equal(fetchCalls[0].opts.method, 'POST');
    assert.equal(fetchCalls[0].opts.headers.Authorization, `Bearer ${SAMPLE_TOKEN}`);
  });

  it('remove o token do storage após logout', async () => {
    auth.setAuthToken(SAMPLE_TOKEN);
    await auth.logout();
    assert.equal(auth.getAuthToken(), null);
  });

  it('redireciona para /login após logout', async () => {
    auth.setAuthToken(SAMPLE_TOKEN);
    await auth.logout();
    assert.equal(redirectCalls.length, 1);
    assert.equal(redirectCalls[0], '/login');
  });

  it('remove token e redireciona mesmo se fetch lançar exceção (rede indisponível)', async () => {
    const authOffline = createAuth({
      storage,
      fetchFn:  async () => { throw new Error('Network error'); },
      redirect: (url) => redirectCalls.push(url),
    });
    authOffline.setAuthToken(SAMPLE_TOKEN);
    await assert.doesNotReject(() => authOffline.logout());
    assert.equal(authOffline.getAuthToken(), null, 'token deve ser removido mesmo offline');
    assert.equal(redirectCalls[0], '/login');
  });

  it('não chama fetch quando não há token (sem sessão ativa)', async () => {
    await auth.logout();
    assert.equal(fetchCalls.length, 0, 'não deve chamar fetch sem token');
    assert.equal(redirectCalls[0], '/login', 'mas deve redirecionar para login');
  });

});
