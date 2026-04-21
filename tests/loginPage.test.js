const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http    = require('node:http');

// Variáveis de ambiente isoladas — sem banco real nem Redis
process.env.DATABASE_URL = '';
process.env.REDIS_URL    = '';
delete process.env.JWT_SECRET;

// ─── Mock do userRepository ANTES de carregar index.js ───────────────────────
// index.js → authHandler → userRepository. Substituir as funções no objeto do
// require cache garante que o handler use os mocks sem tocar em banco real.
const userRepo  = require('../src/database/userRepository');
const auditRepo = require('../src/database/auditRepository');
const authService = require('../src/services/authService');

// Padrão: sem banco
userRepo.getUserByEmail  = async () => null;
userRepo.getUserById     = async () => null;
userRepo.updateLastLogin = async () => null;
auditRepo.logAccess      = async () => null;

// Hash gerado uma vez e reutilizado nos testes de login bem-sucedido
let PASSWORD_HASH;
const ADMIN_USER = {
  id: 1, email: 'admin@essencial.com', role: 'admin',
};

const app = require('../src/index');

let server;
let baseUrl;

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
async function get(path) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, text: await res.text(), headers: res.headers };
}

async function post(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

// =============================================================================
// Suite 1 — Entrega da página de login
// =============================================================================
describe('GET /login — entrega da página', () => {

  it('retorna status 200', async () => {
    const { status } = await get('/login');
    assert.equal(status, 200);
  });

  it('Content-Type é text/html', async () => {
    const { headers } = await get('/login');
    assert.ok(
      headers.get('content-type').includes('text/html'),
      'deve ser text/html'
    );
  });

  it('título contém "Essencial Bot"', async () => {
    const { text } = await get('/login');
    assert.ok(text.includes('Essencial Bot'), 'título deve conter "Essencial Bot"');
  });

  it('contém formulário com id="login-form"', async () => {
    const { text } = await get('/login');
    assert.ok(text.includes('id="login-form"'), 'deve ter form#login-form');
  });

  it('contém campo de e-mail (type=email, required)', async () => {
    const { text } = await get('/login');
    assert.ok(text.includes('type="email"'), 'deve ter input type=email');
    assert.ok(
      text.includes('id="email"'),
      'input de email deve ter id="email"'
    );
    assert.ok(
      text.match(/id="email"[^>]*required|required[^>]*id="email"/),
      'input de email deve ser required'
    );
  });

  it('contém campo de senha (type=password, required)', async () => {
    const { text } = await get('/login');
    assert.ok(text.includes('type="password"'), 'deve ter input type=password');
    assert.ok(
      text.includes('id="password"'),
      'input de senha deve ter id="password"'
    );
    assert.ok(
      text.match(/id="password"[^>]*required|required[^>]*id="password"/),
      'input de senha deve ser required'
    );
  });

  it('contém botão de submit com id="btn-submit"', async () => {
    const { text } = await get('/login');
    assert.ok(text.includes('type="submit"'),    'deve ter button type=submit');
    assert.ok(text.includes('id="btn-submit"'),  'botão deve ter id="btn-submit"');
  });

  it('contém mensagem de erro com atributo hidden', async () => {
    const { text } = await get('/login');
    assert.ok(text.includes('id="error-msg"'), 'deve ter elemento #error-msg');
    assert.ok(
      text.includes('hidden'),
      '#error-msg deve estar hidden por padrão'
    );
  });

  it('contém link "Voltar ao site" apontando para /', async () => {
    const { text } = await get('/login');
    assert.ok(
      text.match(/href=["']\/["']/),
      'deve ter link href="/"'
    );
    assert.ok(
      text.toLowerCase().includes('voltar'),
      'link deve conter texto "Voltar"'
    );
  });

  it('carrega o script auth.js via /dashboard/js/auth.js', async () => {
    const { text } = await get('/login');
    assert.ok(
      text.includes('/dashboard/js/auth.js'),
      'deve referenciar /dashboard/js/auth.js'
    );
  });

});

// =============================================================================
// Suite 2 — Arquivo auth.js acessível
// =============================================================================
describe('GET /dashboard/js/auth.js', () => {

  it('retorna 200', async () => {
    const { status } = await get('/dashboard/js/auth.js');
    assert.equal(status, 200);
  });

  it('Content-Type é application/javascript', async () => {
    const { headers } = await get('/dashboard/js/auth.js');
    const ct = headers.get('content-type');
    assert.ok(
      ct.includes('javascript') || ct.includes('text/plain'),
      `Content-Type inesperado: ${ct}`
    );
  });

  it('contém fetch para /auth/login', async () => {
    const { text } = await get('/dashboard/js/auth.js');
    assert.ok(text.includes('/auth/login'), 'auth.js deve fazer fetch para /auth/login');
  });

  it('referencia localStorage para persistir token', async () => {
    const { text } = await get('/dashboard/js/auth.js');
    assert.ok(text.includes('localStorage'), 'deve usar localStorage');
    assert.ok(text.includes('auth_token'),   'deve salvar como "auth_token"');
  });

  it('redireciona para /dashboard após login bem-sucedido', async () => {
    const { text } = await get('/dashboard/js/auth.js');
    assert.ok(text.includes('/dashboard'), 'deve redirecionar para /dashboard');
  });

});

// =============================================================================
// Suite 3 — POST /auth/login (validações via API)
// =============================================================================
describe('POST /auth/login — comportamento da API', () => {

  it('body vazio → 400', async () => {
    const { status } = await post('/auth/login', {});
    assert.equal(status, 400);
  });

  it('password com menos de 6 chars → 400', async () => {
    const { status, body } = await post('/auth/login', {
      email: 'a@b.com', password: '123',
    });
    assert.equal(status, 400);
    assert.ok(body.error.includes('6 caracteres'));
  });

  it('usuário não encontrado → 401 com mensagem de erro', async () => {
    userRepo.getUserByEmail = async () => null;
    try {
      const { status, body } = await post('/auth/login', {
        email: 'inexistente@x.com', password: 'senha123',
      });
      assert.equal(status, 401);
      assert.equal(body.error, 'Credenciais inválidas');
    } finally {
      userRepo.getUserByEmail = async () => null;
    }
  });

  it('senha incorreta → 401', async () => {
    userRepo.getUserByEmail = async () => ({ ...ADMIN_USER, password_hash: PASSWORD_HASH });
    try {
      const { status, body } = await post('/auth/login', {
        email: ADMIN_USER.email, password: 'senhaerrada',
      });
      assert.equal(status, 401);
      assert.equal(body.error, 'Credenciais inválidas');
    } finally {
      userRepo.getUserByEmail = async () => null;
    }
  });

  it('credenciais válidas → 200 com token JWT (3 partes)', async () => {
    userRepo.getUserByEmail  = async () => ({ ...ADMIN_USER, password_hash: PASSWORD_HASH });
    userRepo.updateLastLogin = async () => null;
    try {
      const { status, body } = await post('/auth/login', {
        email: ADMIN_USER.email, password: 'senha123',
      });
      assert.equal(status, 200);
      assert.ok(typeof body.token === 'string', 'token deve ser string');
      assert.equal(body.token.split('.').length, 3, 'JWT deve ter 3 partes');
    } finally {
      userRepo.getUserByEmail  = async () => null;
      userRepo.updateLastLogin = async () => null;
    }
  });

  it('login bem-sucedido retorna userId, email e role', async () => {
    userRepo.getUserByEmail  = async () => ({ ...ADMIN_USER, password_hash: PASSWORD_HASH });
    userRepo.updateLastLogin = async () => null;
    try {
      const { status, body } = await post('/auth/login', {
        email: ADMIN_USER.email, password: 'senha123',
      });
      assert.equal(status, 200);
      assert.equal(body.userId, ADMIN_USER.id);
      assert.equal(body.email,  ADMIN_USER.email);
      assert.equal(body.role,   ADMIN_USER.role);
    } finally {
      userRepo.getUserByEmail  = async () => null;
      userRepo.updateLastLogin = async () => null;
    }
  });

  it('resposta de login não expõe password_hash', async () => {
    userRepo.getUserByEmail  = async () => ({ ...ADMIN_USER, password_hash: PASSWORD_HASH });
    userRepo.updateLastLogin = async () => null;
    try {
      const { body } = await post('/auth/login', {
        email: ADMIN_USER.email, password: 'senha123',
      });
      assert.ok(!('password_hash' in body), 'password_hash não deve vazar');
    } finally {
      userRepo.getUserByEmail  = async () => null;
      userRepo.updateLastLogin = async () => null;
    }
  });

});
