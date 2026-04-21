const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http    = require('node:http');
const express = require('express');

// Isola variáveis de ambiente para não tocar em produção
delete process.env.JWT_SECRET;
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

// ─── Carrega dependências antes do handler para que os mocks funcionem ────────
// Node.js retorna o mesmo objeto (require cache), então sobrescrever funções
// aqui afeta qualquer módulo que faça require() do mesmo arquivo.
const userRepo    = require('../src/database/userRepository');
const auditRepo   = require('../src/database/auditRepository');
const authService = require('../src/services/authService');

// Padrão-base: todas as operações de banco retornam vazio (sem efeito colateral)
userRepo.getUserByEmail  = async () => null;
userRepo.getUserById     = async () => null;
userRepo.createUser      = async () => null;
userRepo.updateLastLogin = async () => null;
userRepo.listUsers       = async () => [];
auditRepo.logAccess      = async () => null;

const authHandler = require('../src/handlers/authHandler');

// ─── App mínimo de teste ──────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use('/auth', authHandler);

// ─── Estado compartilhado entre suites ───────────────────────────────────────
let server;
let baseUrl;
let PASSWORD_HASH; // bcrypt hash de 'senha123'

const ADMIN  = { id: 1, email: 'admin@essencial.com',  role: 'admin'  };
const VIEWER = { id: 2, email: 'viewer@essencial.com', role: 'viewer' };

// Tokens são gerados com email único por chamada para evitar colisões na blacklist.
// generateJWT usa Math.floor(Date.now()/1000) — tokens gerados no mesmo segundo têm
// payload idêntico e acabam na mesma entrada da blacklist. O contador garante unicidade.
let _seq = 0;
function freshAdminToken()  { return authService.generateJWT(ADMIN.id,  `a${++_seq}@admin.test`);  }
function freshViewerToken() { return authService.generateJWT(VIEWER.id, `v${++_seq}@viewer.test`); }

before(async () => {
  PASSWORD_HASH = await authService.hashPassword('senha123');

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
async function req(method, path, body, headers = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res  = await fetch(`${baseUrl}${path}`, opts);
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

const post = (path, body, hdrs) => req('POST', path, body, hdrs);
const get  = (path, hdrs)       => req('GET',  path, undefined, hdrs);

function bearer(token) { return { Authorization: `Bearer ${token}` }; }

// =============================================================================
// Suite 1 — POST /auth/login
// =============================================================================
describe('POST /auth/login', () => {

  it('sem body → 400 (campos obrigatórios)', async () => {
    const { status, body } = await post('/auth/login', {});
    assert.equal(status, 400);
    assert.ok(body.error.includes('obrigatórios'));
  });

  it('apenas email, sem password → 400', async () => {
    const { status, body } = await post('/auth/login', { email: 'a@b.com' });
    assert.equal(status, 400);
    assert.ok(body.error.includes('obrigatórios'));
  });

  it('password com menos de 6 caracteres → 400', async () => {
    const { status, body } = await post('/auth/login', { email: 'a@b.com', password: '123' });
    assert.equal(status, 400);
    assert.ok(body.error.includes('6 caracteres'));
  });

  it('usuário inexistente → 401 "Credenciais inválidas"', async () => {
    userRepo.getUserByEmail = async () => null;
    try {
      const { status, body } = await post('/auth/login', { email: 'nao@existe.com', password: 'senha123' });
      assert.equal(status, 401);
      assert.equal(body.error, 'Credenciais inválidas');
    } finally {
      userRepo.getUserByEmail = async () => null;
    }
  });

  it('senha errada → 401 "Credenciais inválidas"', async () => {
    userRepo.getUserByEmail = async () => ({ ...ADMIN, password_hash: PASSWORD_HASH });
    try {
      const { status, body } = await post('/auth/login', { email: ADMIN.email, password: 'errada999' });
      assert.equal(status, 401);
      assert.equal(body.error, 'Credenciais inválidas');
    } finally {
      userRepo.getUserByEmail = async () => null;
    }
  });

  it('credenciais válidas → 200 com token, userId, email, role', async () => {
    userRepo.getUserByEmail  = async () => ({ ...ADMIN, password_hash: PASSWORD_HASH });
    userRepo.updateLastLogin = async () => null;
    try {
      const { status, body } = await post('/auth/login', { email: ADMIN.email, password: 'senha123' });
      assert.equal(status, 200);
      assert.ok(typeof body.token === 'string' && body.token.split('.').length === 3, 'deve retornar JWT');
      assert.equal(body.userId, ADMIN.id);
      assert.equal(body.email,  ADMIN.email);
      assert.equal(body.role,   ADMIN.role);
    } finally {
      userRepo.getUserByEmail  = async () => null;
      userRepo.updateLastLogin = async () => null;
    }
  });

  it('login bem-sucedido não retorna password_hash', async () => {
    userRepo.getUserByEmail  = async () => ({ ...ADMIN, password_hash: PASSWORD_HASH });
    userRepo.updateLastLogin = async () => null;
    try {
      const { body } = await post('/auth/login', { email: ADMIN.email, password: 'senha123' });
      assert.ok(!('password_hash' in body), 'password_hash não deve vazar na resposta');
    } finally {
      userRepo.getUserByEmail  = async () => null;
      userRepo.updateLastLogin = async () => null;
    }
  });

});

// =============================================================================
// Suite 2 — POST /auth/logout
// Cada teste gera seu próprio token para não contaminar as suites seguintes.
// =============================================================================
describe('POST /auth/logout', () => {

  it('sem token → 401', async () => {
    const { status } = await post('/auth/logout', {});
    assert.equal(status, 401);
  });

  it('token válido → 200 {message: "Logout successful"}', async () => {
    const token = freshAdminToken();
    const { status, body } = await post('/auth/logout', {}, bearer(token));
    assert.equal(status, 200);
    assert.equal(body.message, 'Logout successful');
  });

  it('token revogado após logout → 401 na próxima requisição', async () => {
    const token = freshAdminToken();
    await post('/auth/logout', {}, bearer(token));
    // Usa o mesmo token em /auth/me — deve ser rejeitado
    const { status } = await get('/auth/me', bearer(token));
    assert.equal(status, 401);
  });

});

// =============================================================================
// Suite 3 — POST /auth/signup (admin only)
// =============================================================================
describe('POST /auth/signup', () => {

  it('sem token → 401', async () => {
    const { status } = await post('/auth/signup', { email: 'n@n.com', password: 'senha123' });
    assert.equal(status, 401);
  });

  it('token de viewer (não-admin) → 403 Forbidden', async () => {
    const token = freshViewerToken();
    userRepo.getUserById = async (id) => id === VIEWER.id ? VIEWER : null;
    try {
      const { status, body } = await post('/auth/signup',
        { email: 'n@n.com', password: 'senha123' },
        bearer(token));
      assert.equal(status, 403);
      assert.equal(body.error, 'Forbidden');
    } finally {
      userRepo.getUserById = async () => null;
    }
  });

  it('admin sem email no body → 400', async () => {
    const token = freshAdminToken();
    userRepo.getUserById = async (id) => id === ADMIN.id ? ADMIN : null;
    try {
      const { status, body } = await post('/auth/signup',
        { password: 'senha123' },
        bearer(token));
      assert.equal(status, 400);
      assert.ok(body.error.includes('obrigatórios'));
    } finally {
      userRepo.getUserById = async () => null;
    }
  });

  it('admin com password curto → 400', async () => {
    const token = freshAdminToken();
    userRepo.getUserById = async (id) => id === ADMIN.id ? ADMIN : null;
    try {
      const { status, body } = await post('/auth/signup',
        { email: 'n@n.com', password: '123' },
        bearer(token));
      assert.equal(status, 400);
      assert.ok(body.error.includes('6 caracteres'));
    } finally {
      userRepo.getUserById = async () => null;
    }
  });

  it('role inválido → 400', async () => {
    const token = freshAdminToken();
    userRepo.getUserById    = async (id) => id === ADMIN.id ? ADMIN : null;
    userRepo.getUserByEmail = async () => null;
    try {
      const { status, body } = await post('/auth/signup',
        { email: 'n@n.com', password: 'senha123', role: 'superuser' },
        bearer(token));
      assert.equal(status, 400);
      assert.ok(body.error.includes('role'));
    } finally {
      userRepo.getUserById    = async () => null;
      userRepo.getUserByEmail = async () => null;
    }
  });

  it('email já cadastrado → 409', async () => {
    const token = freshAdminToken();
    userRepo.getUserById    = async (id) => id === ADMIN.id ? ADMIN : null;
    userRepo.getUserByEmail = async () => VIEWER; // email já existe
    try {
      const { status, body } = await post('/auth/signup',
        { email: VIEWER.email, password: 'senha123' },
        bearer(token));
      assert.equal(status, 409);
      assert.equal(body.error, 'Email já existe');
    } finally {
      userRepo.getUserById    = async () => null;
      userRepo.getUserByEmail = async () => null;
    }
  });

  it('dados válidos → 201 {userId, email, role}', async () => {
    const token     = freshAdminToken();
    const novoEmail = 'novo@essencial.com';
    userRepo.getUserById    = async (id) => id === ADMIN.id ? ADMIN : null;
    userRepo.getUserByEmail = async () => null;
    userRepo.createUser     = async (email, _hash, role) => ({ id: 99, email, role });
    try {
      const { status, body } = await post('/auth/signup',
        { email: novoEmail, password: 'senha123', role: 'viewer' },
        bearer(token));
      assert.equal(status, 201);
      assert.equal(body.userId, 99);
      assert.equal(body.email,  novoEmail);
      assert.equal(body.role,   'viewer');
      assert.ok(!('password_hash' in body), 'password_hash não deve vazar');
    } finally {
      userRepo.getUserById    = async () => null;
      userRepo.getUserByEmail = async () => null;
      userRepo.createUser     = async () => null;
    }
  });

  it('role omitido → cria como viewer por padrão', async () => {
    const token = freshAdminToken();
    userRepo.getUserById    = async (id) => id === ADMIN.id ? ADMIN : null;
    userRepo.getUserByEmail = async () => null;
    let capturedRole;
    userRepo.createUser = async (email, _hash, role) => {
      capturedRole = role;
      return { id: 100, email, role };
    };
    try {
      const { status } = await post('/auth/signup',
        { email: 'default@essencial.com', password: 'senha123' },
        bearer(token));
      assert.equal(status, 201);
      assert.equal(capturedRole, 'viewer', 'role default deve ser viewer');
    } finally {
      userRepo.getUserById    = async () => null;
      userRepo.getUserByEmail = async () => null;
      userRepo.createUser     = async () => null;
    }
  });

});

// =============================================================================
// Suite 4 — GET /auth/me
// =============================================================================
describe('GET /auth/me', () => {

  it('sem token → 401', async () => {
    const { status } = await get('/auth/me');
    assert.equal(status, 401);
  });

  it('token válido → 200 {userId, email, role}', async () => {
    const token = freshAdminToken();
    userRepo.getUserById = async (id) => id === ADMIN.id ? ADMIN : null;
    try {
      const { status, body } = await get('/auth/me', bearer(token));
      assert.equal(status, 200);
      assert.equal(body.userId, ADMIN.id);
      assert.equal(body.email,  ADMIN.email);
      assert.equal(body.role,   ADMIN.role);
    } finally {
      userRepo.getUserById = async () => null;
    }
  });

  it('token válido mas usuário removido do banco → 404', async () => {
    const token = freshAdminToken();
    userRepo.getUserById = async () => null;
    const { status } = await get('/auth/me', bearer(token));
    assert.equal(status, 404);
  });

  it('resposta /me não inclui password_hash', async () => {
    const token = freshAdminToken();
    userRepo.getUserById = async (id) =>
      id === ADMIN.id ? { ...ADMIN, password_hash: PASSWORD_HASH } : null;
    try {
      const { status, body } = await get('/auth/me', bearer(token));
      assert.equal(status, 200);
      assert.ok(!('password_hash' in body), 'password_hash não deve vazar');
    } finally {
      userRepo.getUserById = async () => null;
    }
  });

});

// =============================================================================
// Suite 5 — GET /auth/users (admin only)
// =============================================================================
describe('GET /auth/users', () => {

  it('sem token → 401', async () => {
    const { status } = await get('/auth/users');
    assert.equal(status, 401);
  });

  it('viewer (não-admin) → 403', async () => {
    const token = freshViewerToken();
    userRepo.getUserById = async (id) => id === VIEWER.id ? VIEWER : null;
    try {
      const { status } = await get('/auth/users', bearer(token));
      assert.equal(status, 403);
    } finally {
      userRepo.getUserById = async () => null;
    }
  });

  it('admin → 200 array de usuários', async () => {
    const token     = freshAdminToken();
    const fakeList  = [
      { id: 1, email: ADMIN.email,  role: 'admin',  created_at: new Date(), last_login: null },
      { id: 2, email: VIEWER.email, role: 'viewer', created_at: new Date(), last_login: null },
    ];
    userRepo.getUserById = async (id) => id === ADMIN.id ? ADMIN : null;
    userRepo.listUsers   = async () => fakeList;
    try {
      const { status, body } = await get('/auth/users', bearer(token));
      assert.equal(status, 200);
      assert.ok(Array.isArray(body), 'deve retornar array');
      assert.equal(body.length, 2);
    } finally {
      userRepo.getUserById = async () => null;
      userRepo.listUsers   = async () => [];
    }
  });

  it('lista de usuários não contém password_hash', async () => {
    const token    = freshAdminToken();
    const fakeList = [{ id: 1, email: ADMIN.email, role: 'admin', created_at: new Date() }];
    userRepo.getUserById = async (id) => id === ADMIN.id ? ADMIN : null;
    userRepo.listUsers   = async () => fakeList; // listUsers já exclui password_hash no SQL
    try {
      const { status, body } = await get('/auth/users', bearer(token));
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      for (const u of body) {
        assert.ok(!('password_hash' in u), `user ${u.id} não deve expor password_hash`);
      }
    } finally {
      userRepo.getUserById = async () => null;
      userRepo.listUsers   = async () => [];
    }
  });

});
