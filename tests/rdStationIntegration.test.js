const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── Env: definir ANTES de qualquer require ────────────────────────────────────
// RD_API_KEY precisa estar setada antes do primeiro load de rdStationService
// (a constante API_KEY é capturada no momento do require via Node module cache).
// Como botHandler.test.js carrega o módulo primeiro (ordem alfabética), usamos
// enableService() para substituir _isEnabled() diretamente nos testes do serviço.
process.env.RD_API_KEY = 'test_key_rd';
delete process.env.DATABASE_URL;

// ── Módulos ───────────────────────────────────────────────────────────────────
const https     = require('https');
const rdService = require('../src/services/rdStationService');
const { syncLeadToRD, logRDSync } = require('../src/database/rdStationRepository');
const { handleMessage }           = require('../src/handlers/botHandler');

// =============================================================================
// Mock helpers
// =============================================================================

/**
 * Substitui https.request por uma resposta HTTP simulada.
 * Retorna função de restore — chamar no finally do teste.
 */
function mockHttp(statusCode, body, headers = {}) {
  const original = https.request;
  https.request = (_options, callback) => {
    setImmediate(() => {
      const res = {
        statusCode,
        headers,
        on(event, fn) {
          if (event === 'data') fn(JSON.stringify(body));
          if (event === 'end')  fn();
          return this;
        },
      };
      callback(res);
    });
    return { on() { return this; }, write() {}, end() {}, destroy() {} };
  };
  return () => { https.request = original; };
}

/**
 * Força rdService._isEnabled() a retornar true, independente das constantes
 * capturadas no load do módulo (RD_ENABLED, API_KEY).
 * Retorna função de restore.
 */
function enableService() {
  const original = rdService._isEnabled;
  rdService._isEnabled = () => true;
  return () => { rdService._isEnabled = original; };
}

/**
 * Substitui database.getPool por um pool fake que responde queries com os
 * rows mapeados por substring do SQL. Queries sem match retornam [].
 * Retorna { log, restore }.
 */
function mockPool(rowsMap = {}) {
  const database = require('../src/services/database');
  const original = database.getPool;
  const log      = [];

  database.getPool = () => ({
    query: async (sql, params) => {
      log.push({ sql: sql.trim(), params });
      const key = Object.keys(rowsMap).find(k => sql.includes(k));
      return { rows: key ? rowsMap[key] : [] };
    },
  });

  return { log, restore: () => { database.getPool = original; } };
}

/**
 * Salva e restaura process.env.RD_ENABLED.
 * Retorna função de restore.
 */
function setRdEnabled(value) {
  const prev = process.env.RD_ENABLED;
  process.env.RD_ENABLED = value;
  return () => {
    if (prev === undefined) delete process.env.RD_ENABLED;
    else process.env.RD_ENABLED = prev;
  };
}

// ── Helpers de sessão ─────────────────────────────────────────────────────────
let phoneSeq = 9500;
const nextPhone = () => `whatsapp:+550000${String(phoneSeq++).padStart(7, '0')}`;

async function converse(phone, steps) {
  const responses = [];
  for (const body of steps) {
    responses.push(await handleMessage(phone, body, 'Teste RD'));
  }
  return responses;
}

// =============================================================================
// Suite 1 — rdStationService: HTTP e comportamento do cliente
// =============================================================================
describe('rdStationService', () => {

  it('createContact() retorna contato criado com sucesso (HTTP 201)', async () => {
    const restoreEnable = enableService();
    const restoreHttp   = mockHttp(201, { id: 777, name: 'Julio Ramos', email: 'j@test.com' });
    try {
      const result = await rdService.createContact({ name: 'Julio Ramos', email: 'j@test.com' });
      assert.equal(result.id, 777);
      assert.equal(result.name, 'Julio Ramos');
    } finally { restoreHttp(); restoreEnable(); }
  });

  it('createContact() retorna null para EMAIL_ALREADY_IN_USE (HTTP 422)', async () => {
    const restoreEnable = enableService();
    const restoreHttp   = mockHttp(422, {
      errors: [{ error_type: 'EMAIL_ALREADY_IN_USE', error_message: 'Email already registered' }],
    });
    try {
      const result = await rdService.createContact({ name: 'Dup', email: 'dup@test.com' });
      assert.equal(result, null, 'deve retornar null para e-mail duplicado');
    } finally { restoreHttp(); restoreEnable(); }
  });

  it('createContact() lança erro imediatamente com 401 — sem retry', async () => {
    const restoreEnable = enableService();
    const restoreHttp   = mockHttp(401, { error: 'Unauthorized' });
    try {
      await assert.rejects(
        () => rdService.createContact({ name: 'X', email: 'x@test.com' }),
        (err) => { assert.equal(err.status, 401); return true; }
      );
    } finally { restoreHttp(); restoreEnable(); }
  });

  it('updateContact() retorna contato atualizado (HTTP 200)', async () => {
    const restoreEnable = enableService();
    const restoreHttp   = mockHttp(200, { id: 777, name: 'Julio Atualizado' });
    try {
      const result = await rdService.updateContact(777, { name: 'Julio Atualizado', email: 'j@test.com' });
      assert.equal(result.id, 777);
    } finally { restoreHttp(); restoreEnable(); }
  });

  it('updateContact() lança erro se rdContactId for nulo', async () => {
    const restoreEnable = enableService();
    try {
      await assert.rejects(
        () => rdService.updateContact(null, { email: 'j@test.com' }),
        /rdContactId é obrigatório/
      );
    } finally { restoreEnable(); }
  });

  it('getContact() retorna contato encontrado por e-mail (HTTP 200)', async () => {
    const restoreEnable = enableService();
    const restoreHttp   = mockHttp(200, { contacts: [{ id: 888, email: 'j@test.com' }] });
    try {
      const result = await rdService.getContact('j@test.com');
      assert.equal(result.id, 888);
    } finally { restoreHttp(); restoreEnable(); }
  });

  it('getContact() retorna null quando contato não existe (HTTP 404)', async () => {
    const restoreEnable = enableService();
    const restoreHttp   = mockHttp(404, { error: 'Not Found' });
    try {
      const result = await rdService.getContact('nope@test.com');
      assert.equal(result, null);
    } finally { restoreHttp(); restoreEnable(); }
  });

  it('createContact() retorna null imediatamente quando _isEnabled() = false', async () => {
    // Testa o caminho de retorno antecipado sem fazer nenhuma chamada HTTP
    const origEnabled = rdService._isEnabled;
    rdService._isEnabled = () => false;
    try {
      const result = await rdService.createContact({ name: 'X', email: 'x@test.com' });
      assert.equal(result, null, 'deve retornar null sem chamada HTTP');
    } finally { rdService._isEnabled = origEnabled; }
  });

});

// =============================================================================
// Suite 2 — rdStationRepository: lógica de sincronização e auditoria
// =============================================================================
describe('rdStationRepository', () => {

  it('syncLeadToRD() retorna skipped quando RD_ENABLED=false', async () => {
    const restore = setRdEnabled('false');
    try {
      const result = await syncLeadToRD({ isIcp: true, email: 'j@test.com' }, 1);
      assert.equal(result.skipped, true);
      assert.equal(result.reason, 'RD disabled');
    } finally { restore(); }
  });

  it('syncLeadToRD() retorna skipped quando is_icp=false e sem opt-in de newsletter', async () => {
    const restore = setRdEnabled('true');
    try {
      const result = await syncLeadToRD({ isIcp: false, optInNewsletter: false, email: 'j@test.com' }, 2);
      assert.equal(result.skipped, true);
      assert.equal(result.reason, 'not ICP and no newsletter opt-in');
    } finally { restore(); }
  });

  it('syncLeadToRD() retorna skipped quando e-mail inválido', async () => {
    const restore = setRdEnabled('true');
    try {
      const result = await syncLeadToRD({ isIcp: true, email: 'invalido-sem-arroba' }, 3);
      assert.equal(result.skipped, true);
      assert.equal(result.reason, 'invalid email');
    } finally { restore(); }
  });

  it('syncLeadToRD() retorna skipped quando banco indisponível (sem DATABASE_URL)', async () => {
    const restore = setRdEnabled('true');
    // Sem mockPool → getPool() retorna null (DATABASE_URL não configurada)
    try {
      const result = await syncLeadToRD({ isIcp: true, email: 'j@test.com' }, 4);
      assert.equal(result.skipped, true);
      assert.equal(result.reason, 'DB unavailable');
    } finally { restore(); }
  });

  it('syncLeadToRD() chama createContact quando lead não tem rd_contact_id', async () => {
    const restoreEnv = setRdEnabled('true');
    const { restore: restorePool } = mockPool({
      'SELECT rd_contact_id': [{ rd_contact_id: null }],
      'UPDATE leads':         [],
      'INSERT INTO rd_sync_logs': [],
    });

    const origCreate = rdService.createContact;
    let createCalled = false;
    rdService.createContact = async (payload) => {
      createCalled = true;
      assert.ok(payload.email, 'payload deve conter e-mail');
      return { id: 555, name: payload.name };
    };

    try {
      const session = {
        isIcp: true, email: 'j@test.com', name: 'Julio',
        phone: '11999999999', segment: 'venda',
        location: 'São Paulo, SP', document: null,
        companyName: null, qualificationData: {},
      };
      const result = await syncLeadToRD(session, 10);
      assert.ok(createCalled, 'createContact deve ter sido chamado');
      assert.equal(result.synced, true);
      assert.equal(result.action, 'create');
      assert.equal(result.rdContactId, 555);
    } finally {
      rdService.createContact = origCreate;
      restorePool();
      restoreEnv();
    }
  });

  it('syncLeadToRD() chama updateContact quando lead já tem rd_contact_id', async () => {
    const restoreEnv = setRdEnabled('true');
    const { restore: restorePool } = mockPool({
      'SELECT rd_contact_id': [{ rd_contact_id: 321 }],
      'UPDATE leads':         [],
      'INSERT INTO rd_sync_logs': [],
    });

    const origUpdate = rdService.updateContact;
    let updateCalledWithId = null;
    rdService.updateContact = async (id, payload) => {
      updateCalledWithId = id;
      return { id, name: payload.name };
    };

    try {
      const session = {
        isIcp: true, email: 'j@test.com', name: 'Julio',
        phone: '11999999999', segment: 'venda',
        location: 'Rio de Janeiro, RJ', document: null,
        companyName: null, qualificationData: {},
      };
      const result = await syncLeadToRD(session, 11);
      assert.equal(updateCalledWithId, 321, 'deve passar o rd_contact_id correto');
      assert.equal(result.action, 'update');
    } finally {
      rdService.updateContact = origUpdate;
      restorePool();
      restoreEnv();
    }
  });

  it('logRDSync() insere registro de auditoria em rd_sync_logs', async () => {
    const { log, restore } = mockPool({ 'INSERT INTO rd_sync_logs': [] });
    try {
      await logRDSync(10, 'create', 555, { email: 'j@test.com' }, { id: 555 }, null);
      const insertQuery = log.find(q => q.sql.includes('INSERT INTO rd_sync_logs'));
      assert.ok(insertQuery, 'deve executar INSERT em rd_sync_logs');
      // Params: [lead_id, action, rd_contact_id, request_payload, response_payload, error_message]
      assert.equal(insertQuery.params[0], 10,       'lead_id correto');
      assert.equal(insertQuery.params[1], 'create', 'action correto');
      assert.equal(insertQuery.params[2], 555,      'rd_contact_id correto');
      assert.equal(insertQuery.params[5], null,     'error_message deve ser null no sucesso');
    } finally { restore(); }
  });

  it('syncLeadToRD() persiste rd_sync_status=error quando rdService falha', async () => {
    const restoreEnv = setRdEnabled('true');
    const { log, restore: restorePool } = mockPool({
      'SELECT rd_contact_id': [{ rd_contact_id: null }],
      'UPDATE leads':         [],
      'INSERT INTO rd_sync_logs': [],
    });

    const origCreate = rdService.createContact;
    rdService.createContact = async () => { throw new Error('RD timeout simulado'); };

    try {
      await assert.rejects(
        () => syncLeadToRD({
          isIcp: true, email: 'j@test.com', name: 'Julio',
          phone: '11999999999', segment: 'venda',
          location: null, document: null, companyName: null, qualificationData: {},
        }, 12),
        /RD timeout simulado/
      );

      // updateLeadRdStatus deve ter sido chamado com status='error'
      const updateQuery = log.find(q => q.sql.includes('UPDATE leads'));
      assert.ok(updateQuery, 'deve ter chamado UPDATE leads após o erro');
      assert.ok(
        updateQuery.params.includes('error'),
        `rd_sync_status deve ser "error", params: ${JSON.stringify(updateQuery.params)}`
      );

      // logRDSync também deve ter sido chamado (com o erro)
      const insertQuery = log.find(q => q.sql.includes('INSERT INTO rd_sync_logs'));
      assert.ok(insertQuery, 'deve ter inserido em rd_sync_logs mesmo com erro');
    } finally {
      rdService.createContact = origCreate;
      restorePool();
      restoreEnv();
    }
  });

});

// =============================================================================
// Suite 3 — botHandler: fire-and-forget não bloqueia o fluxo
// =============================================================================
describe('botHandler — fire-and-forget RD Station', () => {

  it('fluxo completo funciona quando RD_ENABLED=false', async () => {
    const restore = setRdEnabled('false');
    const phone   = nextPhone();
    try {
      const responses = await converse(phone, [
        'oi', 'Test RD Off', '52998224725', 'rdoff@test.com', '11900000001',
        '1',             // venda
        'Curitiba, PR',  // localização
        '3',             // kVA ≥ 100 kVA (qualificado)
      ]);
      const closing = responses[7][0];
      assert.ok(closing.includes('entrará em contato'), 'deve confirmar contato mesmo com RD desabilitado');
    } finally { restore(); }
  });

  it('fluxo completo funciona quando rdService.createContact falha (sem banco, fire-and-forget)', async () => {
    const restoreEnv = setRdEnabled('true');

    // Faz createContact lançar exceção; como não há banco, saveLead retorna null
    // e syncLeadToRD nunca chega a ser chamado — confirma que o fluxo não depende da RD
    const origCreate = rdService.createContact;
    rdService.createContact = async () => { throw new Error('RD fora do ar simulado'); };

    const phone = nextPhone();
    try {
      const responses = await converse(phone, [
        'oi', 'Test Fire Forget', '52998224725', 'ff@test.com', '11900000002',
        '2',                  // locação
        'Porto Alegre, RS',   // localização
        '1',                  // contrato mensal
      ]);
      const closing = responses[7][0];
      assert.ok(closing.length > 0, 'deve retornar mensagem de encerramento');
    } finally {
      rdService.createContact = origCreate;
      restoreEnv();
    }
  });

  it('fire-and-forget: RD erro não lança exceção no fluxo quando banco está disponível', async () => {
    const restoreEnv = setRdEnabled('true');

    // Mock pool para fazer saveLead retornar um lead real → ativa o caminho do syncLeadToRD
    const { restore: restorePool } = mockPool({
      'INSERT INTO leads':        [{ id: 99 }],
      'SELECT rd_contact_id':     [{ rd_contact_id: null }],
      'UPDATE leads':             [],
      'INSERT INTO rd_sync_logs': [],
      'INSERT INTO sessions':     [],
    });

    // rdService.createContact lança erro → fire-and-forget captura com .catch()
    const origCreate = rdService.createContact;
    rdService.createContact = async () => { throw new Error('RD indisponível'); };

    const phone = nextPhone();
    try {
      const responses = await converse(phone, [
        'oi', 'Test Bank Fire', '52998224725', 'bff@test.com', '11900000003',
        '1',             // venda
        'Salvador, BA',  // localização
        '3',             // kVA qualificado
      ]);
      // Bot deve ter retornado a mensagem de encerramento normalmente
      const closing = responses[7][0];
      assert.ok(
        closing.includes('entrará em contato') || closing.includes('equipe'),
        'bot deve encerrar normalmente mesmo com RD falhando'
      );
    } finally {
      rdService.createContact = origCreate;
      restorePool();
      restoreEnv();
    }
  });

});
