const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sem banco — testa validações de input e fallbacks
// Usa '' em vez de delete para impedir que dotenv.config() (chamado pelo index.js)
// sobrescreva com o valor do .env — dotenv não faz override de vars já definidas.
process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.BOT_CLOSE_TIMEOUT_MIN = '40';
process.env.CNPJ_API_URL = '';
process.env.JWT_SECRET = 'test-secret-messageapi';

const authService = require('../src/services/authService');
const app = require('../src/index');

// ─── Helpers ──────────────────────────────────────────────────────────────────
let server;
let baseUrl;
let authToken;

async function req(method, path, body) {
  const url = `${baseUrl}${path}`;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

const get  = (path)       => req('GET',  path);
const put  = (path, body) => req('PUT',  path, body);
const post = (path, body) => req('POST', path, body);

// ─── Setup / Teardown ─────────────────────────────────────────────────────────
before(async () => {
  authToken = authService.generateJWT(1, 'test@test.com');

  await new Promise(resolve => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(() => new Promise(resolve => server.close(resolve)));

// ─── GET /api/messages ────────────────────────────────────────────────────────
describe('GET /api/messages', () => {
  it('retorna objeto com campo categories', async () => {
    const { status, body } = await get('/api/messages');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.categories), 'categories deve ser um array');
  });

  it('categories contém ao menos uma categoria', async () => {
    const { body } = await get('/api/messages');
    assert.ok(body.categories.length > 0);
  });

  it('cada categoria tem name, label e messages array', async () => {
    const { body } = await get('/api/messages');
    for (const cat of body.categories) {
      assert.ok(typeof cat.name === 'string', 'category.name deve ser string');
      assert.ok(typeof cat.label === 'string', 'category.label deve ser string');
      assert.ok(Array.isArray(cat.messages), 'category.messages deve ser array');
    }
  });

  it('sem banco retorna fallback com source na resposta', async () => {
    const { body } = await get('/api/messages');
    // Sem banco, os templates vêm do fallback
    const allMessages = body.categories.flatMap(c => c.messages);
    assert.ok(allMessages.length > 0, 'deve retornar templates do fallback');
    assert.ok(allMessages.every(m => m.source === 'fallback'), 'todos devem ter source:fallback');
  });
});

// ─── GET /api/messages/:key ───────────────────────────────────────────────────
describe('GET /api/messages/:key', () => {
  it('retorna 404 para key inexistente', async () => {
    const { status, body } = await get('/api/messages/chave_que_nao_existe');
    assert.equal(status, 404);
    assert.ok(body.error);
  });

  it('retorna template para key existente (via fallback)', async () => {
    const { status, body } = await get('/api/messages/greeting');
    assert.equal(status, 200);
    assert.equal(body.key, 'greeting');
    assert.ok(typeof body.content === 'string' && body.content.length > 0);
  });

  it('retorna template com campos obrigatórios', async () => {
    const { status, body } = await get('/api/messages/askDocument');
    assert.equal(status, 200);
    assert.ok(body.key);
    assert.ok(body.label);
    assert.ok(body.content);
    assert.ok(body.category);
  });
});

// ─── PUT /api/messages/:key ───────────────────────────────────────────────────
describe('PUT /api/messages/:key — validações de input', () => {
  it('retorna 400 quando content está vazio', async () => {
    const { status, body } = await put('/api/messages/greeting', { content: '' });
    assert.equal(status, 400);
    assert.ok(body.error.includes('content'));
  });

  it('retorna 400 quando content é apenas espaços', async () => {
    const { status, body } = await put('/api/messages/greeting', { content: '   ' });
    assert.equal(status, 400);
    assert.ok(body.error.includes('content'));
  });

  it('retorna 400 quando content excede 2000 caracteres', async () => {
    const { status, body } = await put('/api/messages/greeting', { content: 'x'.repeat(2001) });
    assert.equal(status, 400);
    assert.ok(body.error.includes('2000'));
  });

  it('retorna 400 quando falta variável obrigatória {{name}}', async () => {
    const { status, body } = await put('/api/messages/askDocument', {
      content: 'Por favor informe seu CPF ou CNPJ:',
    });
    assert.equal(status, 400);
    assert.ok(body.error.includes('{{name}}'), `esperado {{name}} no erro, recebeu: ${body.error}`);
  });

  it('retorna 400 quando falta variável obrigatória {{company}}', async () => {
    const { status, body } = await put('/api/messages/documentFoundCNPJ', {
      content: 'CNPJ validado com sucesso.',
    });
    assert.equal(status, 400);
    assert.ok(body.error.includes('{{company}}'));
  });

  it('sem banco retorna 503 após validações passarem', async () => {
    // Content válido com variável obrigatória → chega na checagem de banco → 503
    const { status } = await put('/api/messages/askDocument', {
      content: 'Olá {{name}}, informe seu documento:',
    });
    assert.equal(status, 503);
  });
});

// ─── POST /api/messages/preview ───────────────────────────────────────────────
describe('POST /api/messages/preview', () => {
  it('renderiza variáveis no preview', async () => {
    const { status, body } = await post('/api/messages/preview', {
      content: 'Olá *{{name}}*! Bem-vindo à {{company}}.',
      variables: { name: 'Julio', company: 'Essencial' },
    });
    assert.equal(status, 200);
    assert.equal(body.preview, 'Olá *Julio*! Bem-vindo à Essencial.');
  });

  it('retorna whatsapp_preview com HTML formatado', async () => {
    const { status, body } = await post('/api/messages/preview', {
      content: '*negrito* _itálico_ ~riscado~',
      variables: {},
    });
    assert.equal(status, 200);
    assert.ok(body.whatsapp_preview.includes('<strong>negrito</strong>'));
    assert.ok(body.whatsapp_preview.includes('<em>itálico</em>'));
    assert.ok(body.whatsapp_preview.includes('<s>riscado</s>'));
  });

  it('converte quebras de linha em <br>', async () => {
    const { status, body } = await post('/api/messages/preview', {
      content: 'linha1\nlinha2',
      variables: {},
    });
    assert.equal(status, 200);
    assert.ok(body.whatsapp_preview.includes('<br>'));
  });

  it('retorna 400 quando content está vazio', async () => {
    const { status, body } = await post('/api/messages/preview', { content: '' });
    assert.equal(status, 400);
    assert.ok(body.error);
  });

  it('funciona sem banco disponível', async () => {
    const { status } = await post('/api/messages/preview', {
      content: 'Teste sem banco',
      variables: {},
    });
    assert.equal(status, 200);
  });
});
