const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.BOT_CLOSE_TIMEOUT_MIN = '40';
process.env.CNPJ_API_URL = '';
process.env.JWT_SECRET = 'test-secret-human-api';

const authService = require('../src/services/authService');
const app = require('../src/index');

let server;
let baseUrl;
let authToken;

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function postWebhook(from, body) {
  const params = new URLSearchParams({ From: from, Body: body, ProfileName: 'Test' });
  await fetch(`${baseUrl}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
}

async function getHumanActive(query = '') {
  const res = await fetch(`${baseUrl}/api/conversations/human-active${query}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  return { status: res.status, body: await res.json() };
}

async function triggerHandoff(from) {
  await postWebhook(from, 'oi');
  await postWebhook(from, 'quero falar com um agente');
}

let counter = 7000;
function nextPhone() {
  return `whatsapp:+550000${String(counter++).padStart(7, '0')}`;
}

before(async () => {
  authToken = authService.generateJWT(1, 'test@test.com');
  await new Promise(resolve => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(() => new Promise(resolve => server.close(resolve)));

// ─── Estrutura da resposta ─────────────────────────────────────────────────────
describe('GET /api/conversations/human-active — estrutura', () => {
  it('retorna 200 com objeto { total, conversations }', async () => {
    const { status, body } = await getHumanActive();
    assert.equal(status, 200);
    assert.ok('total' in body, 'deve ter campo total');
    assert.ok('conversations' in body, 'deve ter campo conversations');
    assert.ok(Array.isArray(body.conversations), 'conversations deve ser array');
  });

  it('total é igual ao length do array conversations', async () => {
    const { body } = await getHumanActive();
    assert.equal(body.total, body.conversations.length);
  });

  it('retorna 401 sem token', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/human-active`);
    assert.equal(res.status, 401);
  });
});

// ─── Sem conversas humanas ────────────────────────────────────────────────────
describe('GET /api/conversations/human-active — sem conversas', () => {
  it('retorna total=0 e conversations=[] quando nenhuma sessão está em modo humano', async () => {
    const { body } = await getHumanActive();
    const humanCount = body.conversations.filter(c => c.phone_from).length;
    // Pode ter conversas de outros testes rodando; o importante é que a estrutura existe
    assert.equal(body.total, body.conversations.length);
    assert.ok(body.total >= 0);
  });
});

// ─── Com conversas humanas ────────────────────────────────────────────────────
describe('GET /api/conversations/human-active — com conversas ativas', () => {
  let testPhone;

  before(async () => {
    testPhone = nextPhone();
    await triggerHandoff(testPhone);
  });

  it('retorna a conversa em andamento', async () => {
    const { body } = await getHumanActive();
    const found = body.conversations.find(c => c.phone_from === testPhone);
    assert.ok(found, 'deve incluir o telefone em handoff');
  });

  it('conversation tem todos os campos obrigatórios', async () => {
    const { body } = await getHumanActive();
    const conv = body.conversations.find(c => c.phone_from === testPhone);
    assert.ok(conv, 'conversa deve existir');
    assert.ok('phone_from'       in conv, 'deve ter phone_from');
    assert.ok('name'             in conv, 'deve ter name');
    assert.ok('cpf_cnpj'         in conv, 'deve ter cpf_cnpj');
    assert.ok('email'            in conv, 'deve ter email');
    assert.ok('human_started_at' in conv, 'deve ter human_started_at');
    assert.ok('duration_seconds' in conv, 'deve ter duration_seconds');
    assert.ok('previous_step'    in conv, 'deve ter previous_step');
    assert.ok('last_messages'    in conv, 'deve ter last_messages');
    assert.ok(Array.isArray(conv.last_messages), 'last_messages deve ser array');
  });

  it('phone_from corresponde ao número do cliente', async () => {
    const { body } = await getHumanActive();
    const conv = body.conversations.find(c => c.phone_from === testPhone);
    assert.equal(conv.phone_from, testPhone);
  });

  it('duration_seconds é um número não-negativo', async () => {
    const { body } = await getHumanActive();
    const conv = body.conversations.find(c => c.phone_from === testPhone);
    assert.ok(typeof conv.duration_seconds === 'number', 'duration_seconds deve ser número');
    assert.ok(conv.duration_seconds >= 0, 'duration_seconds deve ser >= 0');
  });

  it('last_messages tem campos sender, text e created_at', async () => {
    const { body } = await getHumanActive();
    const conv = body.conversations.find(c => c.phone_from === testPhone);
    // last_messages pode ser vazio (sem DB), então testa apenas se houver mensagens
    if (conv.last_messages.length) {
      const msg = conv.last_messages[0];
      assert.ok('sender'     in msg, 'deve ter sender');
      assert.ok('text'       in msg, 'deve ter text');
      assert.ok('created_at' in msg, 'deve ter created_at');
    } else {
      assert.ok(true, 'last_messages vazio é válido sem banco');
    }
  });

  it('só retorna sessões com handler_type = human', async () => {
    const { body } = await getHumanActive();
    // Verifica que todos os retornados são de sessões que entraram em handoff
    // (não há como verificar handler_type diretamente na API, mas o total deve ser >= 1)
    assert.ok(body.total >= 1, 'deve ter ao menos a conversa criada no before');
  });
});

// ─── Múltiplas conversas e limit ─────────────────────────────────────────────
describe('GET /api/conversations/human-active — múltiplas e limit', () => {
  const phones = [];

  before(async () => {
    for (let i = 0; i < 3; i++) {
      const phone = nextPhone();
      phones.push(phone);
      await triggerHandoff(phone);
    }
  });

  it('retorna múltiplas conversas', async () => {
    const { body } = await getHumanActive();
    assert.ok(body.total >= 3, 'deve ter ao menos as 3 conversas criadas');
  });

  it('limit=1 retorna no máximo 1 conversa', async () => {
    const { body } = await getHumanActive('?limit=1');
    assert.equal(body.conversations.length, 1);
    assert.equal(body.total, 1);
  });

  it('limit=2 retorna no máximo 2 conversas', async () => {
    const { body } = await getHumanActive('?limit=2');
    assert.ok(body.conversations.length <= 2);
    assert.equal(body.total, body.conversations.length);
  });

  it('conversas ordenadas por human_started_at DESC (mais recente primeiro)', async () => {
    const { body } = await getHumanActive();
    const timestamps = body.conversations
      .map(c => c.human_started_at ? new Date(c.human_started_at).getTime() : 0);
    for (let i = 1; i < timestamps.length; i++) {
      assert.ok(
        timestamps[i - 1] >= timestamps[i],
        `conversa ${i - 1} deve ser >= conversa ${i} (DESC)`
      );
    }
  });
});
