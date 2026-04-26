const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';

// ─── Mock do pool de banco ────────────────────────────────────────────────────
// Simula pool.query para testar inserção e query sem banco real.
const db = require('../src/services/database');

let mockRows = [];
let lastQuery = null;
let lastParams = null;
let poolEnabled = false;

const mockPool = {
  query(sql, params) {
    lastQuery = sql;
    lastParams = params;
    return Promise.resolve({ rows: mockRows });
  },
};

function enableMockPool(rows = []) {
  mockRows = rows;
  poolEnabled = true;
  db.getPool = () => mockPool;
}

function disableMockPool() {
  poolEnabled = false;
  db.getPool = () => null;
}

const { saveMessageToHistory, getMessagesByPhone } = require('../src/database/messageHistoryRepository');

// ─── saveMessageToHistory ──────────────────────────────────────────────────────
describe('saveMessageToHistory — sem banco', () => {
  before(() => disableMockPool());

  it('retorna null quando banco indisponível', async () => {
    const result = await saveMessageToHistory('whatsapp:+5511999990001', 'oi', 'client');
    assert.equal(result, null);
  });

  it('não lança exceção sem banco', async () => {
    await assert.doesNotReject(() =>
      saveMessageToHistory('whatsapp:+5511999990001', 'mensagem qualquer', 'bot')
    );
  });
});

describe('saveMessageToHistory — com banco (mock)', () => {
  const fakeRow = {
    id: 1,
    phone_from: 'whatsapp:+5511999990001',
    message_text: 'oi tudo bem',
    sender: 'client',
    session_id: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  before(() => enableMockPool([fakeRow]));
  after(() => disableMockPool());
  beforeEach(() => { lastQuery = null; lastParams = null; mockRows = [fakeRow]; });

  it('retorna a linha inserida', async () => {
    const result = await saveMessageToHistory('whatsapp:+5511999990001', 'oi tudo bem', 'client');
    assert.deepEqual(result, fakeRow);
  });

  it('passa phone, message e sender corretos para o banco', async () => {
    await saveMessageToHistory('whatsapp:+5511999990002', 'mensagem do bot', 'bot');
    assert.equal(lastParams[0], 'whatsapp:+5511999990002');
    assert.equal(lastParams[1], 'mensagem do bot');
    assert.equal(lastParams[2], 'bot');
  });

  it('aceita sender "client"', async () => {
    await saveMessageToHistory('whatsapp:+5511999990001', 'texto', 'client');
    assert.equal(lastParams[2], 'client');
  });

  it('aceita sender "bot"', async () => {
    await saveMessageToHistory('whatsapp:+5511999990001', 'texto', 'bot');
    assert.equal(lastParams[2], 'bot');
  });

  it('aceita sender "agent"', async () => {
    await saveMessageToHistory('whatsapp:+5511999990001', 'texto', 'agent');
    assert.equal(lastParams[2], 'agent');
  });

  it('usa "client" como sender padrão', async () => {
    await saveMessageToHistory('whatsapp:+5511999990001', 'texto');
    assert.equal(lastParams[2], 'client');
  });

  it('usa INSERT INTO message_history', async () => {
    await saveMessageToHistory('whatsapp:+5511999990001', 'texto', 'client');
    assert.ok(lastQuery.includes('INSERT INTO message_history'), 'deve usar INSERT INTO message_history');
  });
});

// ─── getMessagesByPhone ───────────────────────────────────────────────────────
describe('getMessagesByPhone — sem banco', () => {
  before(() => disableMockPool());

  it('retorna array vazio quando banco indisponível', async () => {
    const result = await getMessagesByPhone('whatsapp:+5511999990001');
    assert.deepEqual(result, []);
  });
});

describe('getMessagesByPhone — com banco (mock)', () => {
  const fakeMessages = [
    { id: 2, phone_from: 'whatsapp:+5511999990001', message_text: 'segunda mensagem', sender: 'agent', created_at: new Date() },
    { id: 1, phone_from: 'whatsapp:+5511999990001', message_text: 'primeira mensagem', sender: 'client', created_at: new Date() },
  ];

  before(() => enableMockPool(fakeMessages));
  after(() => disableMockPool());
  beforeEach(() => { lastQuery = null; lastParams = null; mockRows = fakeMessages; });

  it('retorna as mensagens do banco', async () => {
    const result = await getMessagesByPhone('whatsapp:+5511999990001');
    assert.equal(result.length, 2);
    assert.equal(result[0].message_text, 'segunda mensagem');
  });

  it('passa o phone_from correto na query', async () => {
    await getMessagesByPhone('whatsapp:+5511999990003');
    assert.equal(lastParams[0], 'whatsapp:+5511999990003');
  });

  it('usa o limit padrão de 50 quando não informado', async () => {
    await getMessagesByPhone('whatsapp:+5511999990001');
    assert.equal(lastParams[1], 50);
  });

  it('respeita limit customizado', async () => {
    await getMessagesByPhone('whatsapp:+5511999990001', 10);
    assert.equal(lastParams[1], 10);
  });

  it('usa SELECT * FROM message_history com WHERE phone_from', async () => {
    await getMessagesByPhone('whatsapp:+5511999990001');
    assert.ok(lastQuery.includes('message_history'), 'deve consultar message_history');
    assert.ok(lastQuery.includes('phone_from'), 'deve filtrar por phone_from');
  });

  it('retorna array vazio quando query não encontra resultados', async () => {
    mockRows = [];
    const result = await getMessagesByPhone('whatsapp:+5511000000000');
    assert.deepEqual(result, []);
  });
});
