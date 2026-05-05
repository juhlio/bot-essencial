const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.BOT_CLOSE_TIMEOUT_MIN = '40';
process.env.CNPJ_API_URL = '';
process.env.JWT_SECRET = 'test-secret-end-human';

const authService = require('../src/services/authService');
const app = require('../src/index');

let server;
let baseUrl;
let authToken;

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function postWebhook(phoneNumber, text, name = 'Test') {
  const payload = {
    data: {
      key: {
        remoteJid: `${phoneNumber}@s.whatsapp.net`,
        id: `test-${Date.now()}`,
        fromMe: false,
      },
      message: { conversation: text },
      pushName: name,
    },
  };
  const res = await fetch(`${baseUrl}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, contentType: ct, json: ct.includes('json') ? await res.json() : null };
}

async function endHuman(from, body = {}) {
  const encoded = encodeURIComponent(from);
  const res = await fetch(`${baseUrl}/api/conversations/${encoded}/end-human`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function setupHumanSession(from) {
  await postWebhook(from, 'oi');
  await postWebhook(from, 'quero falar com um agente');
}

let counter = 8000;
function nextPhone() {
  return `5500008${String(counter++).padStart(6, '0')}`;
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

// ─── Sucesso ──────────────────────────────────────────────────────────────────
describe('POST /api/conversations/:from/end-human — sucesso', () => {
  it('retorna status 200 e status:success', async () => {
    const phone = nextPhone();
    await setupHumanSession(phone);
    const { status, body } = await endHuman(phone);
    assert.equal(status, 200);
    assert.equal(body.status, 'success');
  });

  it('handler_type volta para "bot"', async () => {
    const phone = nextPhone();
    await setupHumanSession(phone);
    const { body } = await endHuman(phone);
    assert.equal(body.session.handler_type, 'bot');
  });

  it('step volta ao previous_step (greeting → awaiting_name após handoff em greeting)', async () => {
    const phone = nextPhone();
    await setupHumanSession(phone);
    const { body } = await endHuman(phone);
    assert.equal(body.session.step, body.session.previous_step || 'closing');
  });

  it('step volta para awaiting_name quando handoff ocorreu nesse step', async () => {
    const phone = nextPhone();
    await postWebhook(phone, 'oi');          // step → awaiting_name
    await postWebhook(phone, 'falar com agente');  // handoff em awaiting_name
    const { body } = await endHuman(phone);
    assert.equal(body.session.step, 'awaiting_name');
  });

  it('human_ended_at é definido na sessão', async () => {
    const phone = nextPhone();
    await setupHumanSession(phone);
    const { body } = await endHuman(phone);
    assert.ok(body.session.human_ended_at, 'human_ended_at deve estar definido');
  });

  it('aceita reason opcional no body sem erros', async () => {
    const phone = nextPhone();
    await setupHumanSession(phone);
    const { status } = await endHuman(phone, { reason: 'Atendimento concluído' });
    assert.equal(status, 200);
  });

  it('retorna objeto session com campos esperados', async () => {
    const phone = nextPhone();
    await setupHumanSession(phone);
    const { body } = await endHuman(phone);
    assert.ok(body.session);
    assert.ok('handler_type' in body.session);
    assert.ok('step' in body.session);
  });
});

// ─── Erros ────────────────────────────────────────────────────────────────────
describe('POST /api/conversations/:from/end-human — erros', () => {
  it('retorna 404 para sessão que nunca existiu', async () => {
    const phone = `5500000000000`;
    const { status, body } = await endHuman(phone);
    assert.equal(status, 404);
    assert.ok(body.error, 'deve ter mensagem de erro');
  });

  it('retorna 409 quando handler_type já é "bot"', async () => {
    const phone = nextPhone();
    await postWebhook(phone, 'oi'); // cria sessão em modo bot
    const { status, body } = await endHuman(phone);
    assert.equal(status, 409);
    assert.ok(body.error.includes('humano') || body.error.includes('atendimento'), 'mensagem deve indicar que não está em modo humano');
  });

  it('retorna 409 após já ter encerrado o atendimento humano (duplo encerramento)', async () => {
    const phone = nextPhone();
    await setupHumanSession(phone);
    await endHuman(phone);        // primeiro encerramento → sucesso
    const { status } = await endHuman(phone); // segundo encerramento → 409
    assert.equal(status, 409);
  });

  it('retorna 401 sem token de autenticação', async () => {
    const phone = nextPhone();
    await setupHumanSession(phone);
    const encoded = encodeURIComponent(phone);
    const res = await fetch(`${baseUrl}/api/conversations/${encoded}/end-human`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 401);
  });
});

// ─── Após encerramento ────────────────────────────────────────────────────────
describe('Comportamento após encerrar atendimento humano', () => {
  it('bot volta a processar mensagens após encerramento', async () => {
    const phone = nextPhone();
    await setupHumanSession(phone);
    await endHuman(phone);

    // Próxima mensagem deve ser processada pelo bot (retorna JSON success)
    const { contentType, json } = await postWebhook(phone, 'oi');
    assert.ok(contentType.includes('application/json'), 'bot deve voltar a responder com JSON');
    assert.equal(json.status, 'success', 'bot deve processar a mensagem normalmente');
  });
});
