const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http    = require('node:http');

// Sem banco real nem Redis
process.env.DATABASE_URL = '';
process.env.REDIS_URL    = '';
delete process.env.JWT_SECRET;

// Mocks mínimos antes de carregar o app
const userRepo  = require('../src/database/userRepository');
const auditRepo = require('../src/database/auditRepository');
userRepo.getUserByEmail  = async () => null;
userRepo.getUserById     = async () => null;
userRepo.updateLastLogin = async () => null;
auditRepo.logAccess      = async () => null;

const app = require('../src/index');

let server;
let baseUrl;

before(() => new Promise(resolve => {
  server = http.createServer(app);
  server.listen(0, '127.0.0.1', () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise(resolve => server.close(resolve)));

async function get(path) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, text: await res.text(), headers: res.headers };
}

// =============================================================================
// Suite 1 — Entrega da página do dashboard
// =============================================================================
describe('GET /dashboard — entrega da página', () => {

  it('retorna status 200', async () => {
    const { status } = await get('/dashboard');
    assert.equal(status, 200);
  });

  it('Content-Type é text/html', async () => {
    const { headers } = await get('/dashboard');
    assert.ok(headers.get('content-type').includes('text/html'));
  });

  it('título contém "Essencial Bot"', async () => {
    const { text } = await get('/dashboard');
    assert.ok(text.includes('Essencial Bot'), 'título deve conter "Essencial Bot"');
  });

});

// =============================================================================
// Suite 2 — Auth guard no HTML
// Verifica que o código de proteção está presente no HTML entregue.
// O guard é client-side (JS), portanto o servidor sempre devolve 200;
// o teste confirma que o HTML contém a lógica de redirecionamento correta.
// =============================================================================
describe('Auth guard — código de proteção no HTML', () => {

  it('auth.js é carregado no <head> (antes do body)', async () => {
    const { text } = await get('/dashboard');
    // auth.js deve aparecer dentro do <head>, antes do fechamento </head>
    const headSection = text.slice(0, text.indexOf('</head>'));
    assert.ok(
      headSection.includes('/js/auth.js'),
      'auth.js deve estar no <head> para execução síncrona'
    );
  });

  it('script guard invoca Auth.isAuthenticated()', async () => {
    const { text } = await get('/dashboard');
    assert.ok(
      text.includes('Auth.isAuthenticated()'),
      'deve verificar Auth.isAuthenticated()'
    );
  });

  it('script guard redireciona para /login se não autenticado', async () => {
    const { text } = await get('/dashboard');
    assert.ok(
      text.includes("window.location.href = '/login'"),
      "deve redirecionar para '/login'"
    );
  });

  it('script guard vem ANTES do <header> no DOM', async () => {
    const { text } = await get('/dashboard');
    const guardPos  = text.indexOf('Auth.isAuthenticated()');
    const headerPos = text.indexOf('<header');
    assert.ok(guardPos > 0,      'guard deve existir na página');
    assert.ok(guardPos < headerPos, 'guard deve aparecer antes do <header>');
  });

});

// =============================================================================
// Suite 3 — Header do dashboard
// =============================================================================
describe('Header do dashboard', () => {

  it('contém título "Essencial Bot"', async () => {
    const { text } = await get('/dashboard');
    assert.ok(text.includes('Essencial Bot'), 'deve exibir "Essencial Bot"');
  });

  it('contém elemento #user-email para saudação', async () => {
    const { text } = await get('/dashboard');
    assert.ok(text.includes('id="user-email"'), 'deve ter #user-email para o e-mail do usuário');
  });

  it('contém texto "Olá" para a saudação do usuário', async () => {
    const { text } = await get('/dashboard');
    assert.ok(text.includes('Olá'), 'deve conter texto de saudação "Olá"');
  });

  it('contém botão de logout com id="btn-logout"', async () => {
    const { text } = await get('/dashboard');
    assert.ok(text.includes('id="btn-logout"'), 'deve ter #btn-logout');
  });

  it('botão de logout tem texto "Logout"', async () => {
    const { text } = await get('/dashboard');
    assert.ok(text.includes('>Logout<'), 'texto do botão deve ser "Logout"');
  });

});

// =============================================================================
// Suite 4 — Rota /js/auth.js acessível no root
// auth.js deve ser servido em /js/auth.js para que o <head> possa carregá-lo.
// =============================================================================
describe('GET /js/auth.js — rota raiz para auth utilitário', () => {

  it('retorna 200', async () => {
    const { status } = await get('/js/auth.js');
    assert.equal(status, 200);
  });

  it('Content-Type é application/javascript', async () => {
    const { headers } = await get('/js/auth.js');
    const ct = headers.get('content-type');
    assert.ok(ct.includes('javascript') || ct.includes('text/plain'), `tipo inesperado: ${ct}`);
  });

  it('expõe createAuth e window.Auth', async () => {
    const { text } = await get('/js/auth.js');
    assert.ok(text.includes('createAuth'),  'deve ter createAuth');
    assert.ok(text.includes('window.Auth'), 'deve atribuir window.Auth');
  });

  it('conteúdo é idêntico ao servido em /dashboard/js/auth.js', async () => {
    const [r1, r2] = await Promise.all([
      get('/js/auth.js'),
      get('/dashboard/js/auth.js'),
    ]);
    assert.equal(r1.text, r2.text, 'ambas as rotas devem servir o mesmo arquivo');
  });

});
