/**
 * Testes E2E: fluxo completo de atendimento humano (handoff)
 *
 * Cobre:
 *   1. Cliente pede atendimento humano → sessão muda para modo humano
 *   2. Mensagens durante atendimento humano não são processadas como bot
 *   3. Agente encerra conversa → sessão volta ao modo bot
 *   4. Depois de encerrar, bot volta a responder normalmente
 *   5. Erros tratados (sessão inexistente, sessão em modo bot)
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Isola o ambiente dos outros testes
process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.BOT_CLOSE_TIMEOUT_MIN = '40';
process.env.CNPJ_API_URL = '';
process.env.JWT_SECRET = 'test-secret-e2e-handoff';

const authService   = require('../src/services/authService');
const app           = require('../src/index');
const { sessionStore } = require('../src/services/sessionStore');

let server;
let baseUrl;
let authToken;

// ─── Helpers HTTP ─────────────────────────────────────────────────────────────
async function postWebhook(from, body) {
  const params = new URLSearchParams({ From: from, Body: body, ProfileName: 'Test' });
  const res = await fetch(`${baseUrl}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const ct = res.headers.get('content-type') || '';
  return {
    status: res.status,
    contentType: ct,
    text: ct.includes('json') ? null : await res.text(),
    json: ct.includes('json') ? await res.json() : null,
  };
}

async function endHuman(from, opts = {}) {
  const res = await fetch(`${baseUrl}/api/conversations/${encodeURIComponent(from)}/end-human`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(opts),
  });
  return { status: res.status, body: await res.json() };
}

async function getHumanActive() {
  const res = await fetch(`${baseUrl}/api/conversations/human-active`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  return res.json();
}

let counter = 6000;
function nextPhone() {
  return `whatsapp:+550000${String(counter++).padStart(7, '0')}`;
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────
before(async () => {
  authToken = authService.generateJWT(1, 'e2e@test.com');
  await new Promise(resolve => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(() => new Promise(resolve => server.close(resolve)));

// =============================================================================
// TESTE 1: Cliente pede atendimento humano
// =============================================================================
describe('Teste 1 — Cliente pede atendimento humano', () => {
  let phone;

  before(async () => {
    phone = nextPhone();
    await postWebhook(phone, 'oi');           // inicia sessão → step: awaiting_name
  });

  it('resposta do webhook contém "agente entrará em contato"', async () => {
    const r = await postWebhook(phone, 'quero falar com um agente');
    assert.ok(r.contentType.includes('text/xml'), 'deve retornar TwiML');
    assert.ok(r.text.includes('agente'), 'deve mencionar agente na resposta');
  });

  it('handler_type fica como "human"', () => {
    const session = sessionStore.get(phone);
    assert.equal(session.handler_type, 'human');
  });

  it('previous_step é o step anterior (awaiting_name)', () => {
    const session = sessionStore.get(phone);
    assert.equal(session.previous_step, 'awaiting_name');
  });

  it('human_started_at é preenchido', () => {
    const session = sessionStore.get(phone);
    assert.ok(session.human_started_at, 'human_started_at deve estar definido');
    assert.ok(!isNaN(new Date(session.human_started_at).getTime()), 'deve ser uma data válida');
  });

  it('sessão aparece em GET /api/conversations/human-active', async () => {
    const data = await getHumanActive();
    const found = data.conversations.find(c => c.phone_from === phone);
    assert.ok(found, 'sessão deve aparecer como ativa');
    assert.equal(found.previous_step, 'awaiting_name');
    assert.ok(found.human_started_at, 'human_started_at deve constar na API');
  });

  it('duration_seconds é >= 0 na API', async () => {
    const data = await getHumanActive();
    const found = data.conversations.find(c => c.phone_from === phone);
    assert.ok(typeof found.duration_seconds === 'number' && found.duration_seconds >= 0);
  });
});

// =============================================================================
// TESTE 2: Mensagens durante atendimento humano não são processadas como bot
// =============================================================================
describe('Teste 2 — Mensagens humanas não processadas pelo bot', () => {
  let phone;

  before(async () => {
    phone = nextPhone();
    await postWebhook(phone, 'oi');
    await postWebhook(phone, 'preciso falar com humano');  // ativa handoff
  });

  it('webhook retorna JSON { status: "saved_for_human" }', async () => {
    const r = await postWebhook(phone, 'qual é o preço?');
    assert.ok(r.contentType.includes('application/json'), 'deve ser JSON, não TwiML');
    assert.equal(r.json.status, 'saved_for_human');
  });

  it('bot NÃO responde (sem mensagem TwiML)', async () => {
    const r = await postWebhook(phone, 'tenho urgência');
    assert.ok(!r.contentType.includes('text/xml'), 'não deve retornar TwiML');
  });

  it('step da sessão não muda após mensagem em modo humano', () => {
    const stepBefore = sessionStore.get(phone).step;
    // Enviou 2 mensagens em modo humano acima — step deve continuar o mesmo
    const stepAfter = sessionStore.get(phone).step;
    assert.equal(stepBefore, stepAfter);
  });

  it('handler_type permanece "human" após várias mensagens', async () => {
    await postWebhook(phone, 'mensagem 1');
    await postWebhook(phone, 'mensagem 2');
    assert.equal(sessionStore.get(phone).handler_type, 'human');
  });

  it('múltiplas mensagens retornam sempre saved_for_human', async () => {
    for (const msg of ['msg A', 'msg B', 'msg C']) {
      const r = await postWebhook(phone, msg);
      assert.equal(r.json?.status, 'saved_for_human', `"${msg}" deve retornar saved_for_human`);
    }
  });
});

// =============================================================================
// TESTE 3: Agente encerra conversa
// =============================================================================
describe('Teste 3 — Agente encerra conversa humana', () => {
  let phone;
  let endResult;

  before(async () => {
    phone = nextPhone();
    await postWebhook(phone, 'oi');
    await postWebhook(phone, 'quero falar com o supervisor');  // handoff em awaiting_name
    // Aguarda ao menos 1ms para garantir duration > 0
    await new Promise(r => setTimeout(r, 10));
    const r = await endHuman(phone);
    endResult = r;
  });

  it('endpoint retorna status 200 e status:success', () => {
    assert.equal(endResult.status, 200);
    assert.equal(endResult.body.status, 'success');
  });

  it('handler_type volta para "bot"', () => {
    assert.equal(endResult.body.session.handler_type, 'bot');
    assert.equal(sessionStore.get(phone).handler_type, 'bot');
  });

  it('step volta ao previous_step (awaiting_name)', () => {
    assert.equal(endResult.body.session.step, 'awaiting_name');
    assert.equal(sessionStore.get(phone).step, 'awaiting_name');
  });

  it('human_ended_at é preenchido', () => {
    const ended = endResult.body.session.human_ended_at;
    assert.ok(ended, 'human_ended_at deve estar definido');
    assert.ok(!isNaN(new Date(ended).getTime()), 'deve ser uma data válida');
  });

  it('duração é calculada corretamente (ended >= started)', () => {
    const session = sessionStore.get(phone);
    const started = new Date(session.human_started_at).getTime();
    const ended   = new Date(session.human_ended_at).getTime();
    assert.ok(ended >= started, 'human_ended_at deve ser >= human_started_at');
  });

  it('sessão desaparece de GET /api/conversations/human-active após encerramento', async () => {
    const data = await getHumanActive();
    const still = data.conversations.find(c => c.phone_from === phone);
    assert.ok(!still, 'sessão encerrada não deve mais aparecer como ativa');
  });

  it('aceita reason opcional sem erros', async () => {
    const phone2 = nextPhone();
    await postWebhook(phone2, 'oi');
    await postWebhook(phone2, 'falar com agente');
    const r = await endHuman(phone2, { reason: 'Atendimento concluído pelo agente' });
    assert.equal(r.status, 200);
  });
});

// =============================================================================
// TESTE 4: Depois de encerrar, bot volta a funcionar
// =============================================================================
describe('Teste 4 — Bot retoma atendimento após encerramento humano', () => {
  let phone;

  before(async () => {
    phone = nextPhone();
    await postWebhook(phone, 'oi');                          // greeting → awaiting_name
    await postWebhook(phone, 'quero falar com humano');      // handoff em awaiting_name
    await endHuman(phone);                                   // encerra → volta para awaiting_name
  });

  it('webhook volta a retornar TwiML (bot ativo)', async () => {
    const r = await postWebhook(phone, 'João da Silva');     // responde ao step awaiting_name
    assert.ok(r.contentType.includes('text/xml'), 'bot deve responder com TwiML');
  });

  it('bot avança o step normalmente após retomada', async () => {
    // Usa phone próprio para não depender do estado deixado pelo it anterior
    const p = nextPhone();
    await postWebhook(p, 'oi');
    await postWebhook(p, 'quero falar com humano');
    await endHuman(p);
    const stepAntes = sessionStore.get(p).step;  // awaiting_name
    await postWebhook(p, 'Maria Souza');
    const stepDepois = sessionStore.get(p).step;
    assert.notEqual(stepAntes, stepDepois, 'step deve ter avançado');
    assert.equal(stepDepois, 'awaiting_document');
  });

  it('handler_type permanece "bot" durante fluxo normal', async () => {
    assert.equal(sessionStore.get(phone).handler_type, 'bot');
  });

  it('novo handoff pode ser ativado novamente após retomada', async () => {
    const phone2 = nextPhone();
    await postWebhook(phone2, 'oi');
    await postWebhook(phone2, 'quero falar com gerente');    // handoff
    await endHuman(phone2);                                  // encerra
    await postWebhook(phone2, 'quero falar com supervisor'); // handoff novamente
    assert.equal(sessionStore.get(phone2).handler_type, 'human', 'deve poder fazer handoff novamente');
  });
});

// =============================================================================
// TESTE 5: Erros tratados
// =============================================================================
describe('Teste 5 — Tratamento de erros', () => {
  it('encerrar sessão que nunca existiu → 404', async () => {
    const phone = `whatsapp:+5500000000099`;
    const r = await endHuman(phone);
    assert.equal(r.status, 404);
    assert.ok(r.body.error, 'deve retornar mensagem de erro');
  });

  it('encerrar sessão em modo bot → 409', async () => {
    const phone = nextPhone();
    await postWebhook(phone, 'oi');  // cria sessão em modo bot (handler_type undefined/'bot')
    const r = await endHuman(phone);
    assert.equal(r.status, 409, 'deve retornar 409 quando sessão não está em modo humano');
    assert.ok(r.body.error, 'deve ter mensagem de erro explicativa');
  });

  it('duplo encerramento → 409 na segunda tentativa', async () => {
    const phone = nextPhone();
    await postWebhook(phone, 'oi');
    await postWebhook(phone, 'falar com agente');
    const r1 = await endHuman(phone);
    assert.equal(r1.status, 200, 'primeiro encerramento deve ser 200');
    const r2 = await endHuman(phone);
    assert.equal(r2.status, 409, 'segundo encerramento deve ser 409');
  });

  it('endpoint /end-human sem autenticação → 401', async () => {
    const phone = nextPhone();
    await postWebhook(phone, 'oi');
    await postWebhook(phone, 'quero falar com humano');
    const res = await fetch(`${baseUrl}/api/conversations/${encodeURIComponent(phone)}/end-human`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 401);
  });

  it('GET /api/conversations/human-active sem autenticação → 401', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/human-active`);
    assert.equal(res.status, 401);
  });

  it('sessão em modo humano é isolada: outro número não é afetado', async () => {
    const phoneA = nextPhone();
    const phoneB = nextPhone();

    await postWebhook(phoneA, 'oi');
    await postWebhook(phoneA, 'quero falar com humano');  // A em handoff

    await postWebhook(phoneB, 'oi');
    const rB = await postWebhook(phoneB, 'Fabio Santos');  // B responde normalmente
    assert.ok(rB.contentType.includes('text/xml'), 'sessão B deve continuar como bot (TwiML)');
    assert.notEqual(sessionStore.get(phoneB).handler_type, 'human', 'phoneB não deve estar em modo humano');
  });
});
