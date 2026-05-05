const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.BOT_CLOSE_TIMEOUT_MIN = '40';
process.env.CNPJ_API_URL = '';
process.env.JWT_SECRET = 'test-secret-webhook';

const app = require('../src/index');

let server;
let baseUrl;

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
  const contentType = res.headers.get('content-type') || '';
  const responseBody = contentType.includes('json') ? await res.json() : await res.text();
  return { status: res.status, contentType, payload: responseBody };
}

let phoneCounter = 9000;
function nextPhone() {
  return `5500009${String(phoneCounter++).padStart(6, '0')}`;
}

before(async () => {
  await new Promise(resolve => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(() => new Promise(resolve => server.close(resolve)));

// ─── Fluxo normal ─────────────────────────────────────────────────────────────
describe('POST /webhook — fluxo normal (handler_type = bot)', () => {
  it('responde com JSON { status: "success" } para mensagem comum', async () => {
    const phone = nextPhone();
    const { status, contentType, payload } = await postWebhook(phone, 'oi');
    assert.equal(status, 200);
    assert.ok(contentType.includes('application/json'), 'deve retornar JSON');
    assert.equal(payload.status, 'success');
  });

  it('webhook processa mensagem e retorna status success', async () => {
    const phone = nextPhone();
    const { payload } = await postWebhook(phone, 'oi');
    assert.equal(payload.status, 'success');
  });
});

// ─── Handoff humano ───────────────────────────────────────────────────────────
describe('POST /webhook — handoff humano (handler_type = human)', () => {
  it('primeira mensagem de handoff retorna JSON { status: "success" }', async () => {
    const phone = nextPhone();
    await postWebhook(phone, 'oi');
    const { status, contentType, payload } = await postWebhook(phone, 'quero falar com um agente');
    assert.equal(status, 200);
    assert.ok(contentType.includes('application/json'), 'deve retornar JSON');
    assert.equal(payload.status, 'success');
  });

  it('mensagem subsequente retorna JSON saved_for_human', async () => {
    const phone = nextPhone();
    await postWebhook(phone, 'oi');
    await postWebhook(phone, 'preciso falar com humano');
    const { status, contentType, payload } = await postWebhook(phone, 'qual o preço?');
    assert.equal(status, 200);
    assert.ok(contentType.includes('application/json'), 'deve retornar JSON');
    assert.equal(payload.status, 'saved_for_human');
  });

  it('bot não responde após handoff (retorna saved_for_human, não success)', async () => {
    const phone = nextPhone();
    await postWebhook(phone, 'oi');
    await postWebhook(phone, 'falar com agente');
    const { payload } = await postWebhook(phone, 'minha dúvida aqui');
    assert.equal(payload.status, 'saved_for_human');
  });

  it('múltiplas mensagens humanas retornam sempre saved_for_human', async () => {
    const phone = nextPhone();
    await postWebhook(phone, 'oi');
    await postWebhook(phone, 'quero falar com o supervisor');
    for (const msg of ['mensagem 1', 'mensagem 2', 'mensagem 3']) {
      const { payload } = await postWebhook(phone, msg);
      assert.equal(payload.status, 'saved_for_human', `"${msg}" deve retornar saved_for_human`);
    }
  });
});

// ─── Independência entre sessões ─────────────────────────────────────────────
describe('POST /webhook — isolamento de sessões', () => {
  it('handoff em um número não afeta outro número', async () => {
    const phoneA = nextPhone();
    const phoneB = nextPhone();

    await postWebhook(phoneA, 'oi');
    await postWebhook(phoneA, 'quero falar com humano');

    await postWebhook(phoneB, 'oi');
    const { contentType, payload } = await postWebhook(phoneB, 'qual é o preço?');
    assert.ok(contentType.includes('application/json'), 'telefone B deve continuar recebendo JSON');
    assert.equal(payload.status, 'success', 'telefone B deve continuar sendo processado pelo bot');
  });
});
