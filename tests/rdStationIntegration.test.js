const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── Env: definir ANTES de qualquer require ────────────────────────────────────
// RD_STATION_API_KEY e RD_STATION_ENABLED precisam estar setadas antes do
// primeiro load de rdStationService (constantes capturadas no require).
// Como botHandler.test.js carrega o módulo primeiro (ordem alfabética), usamos
// enableService() para substituir _isEnabled() diretamente nos testes.
process.env.RD_STATION_API_KEY     = 'test_key_rd';
process.env.RD_STATION_ENABLED     = 'true';
delete process.env.DATABASE_URL;

// ── Módulos ───────────────────────────────────────────────────────────────────
const rdService = require('../src/services/rdStationService');
const { syncLeadToRD, logRDSync } = require('../src/database/rdStationRepository');
const { handleMessage }           = require('../src/handlers/botHandler');

// =============================================================================
// Mock helpers
// =============================================================================

/**
 * Substitui global.fetch por uma resposta simulada.
 * Retorna função de restore — chamar no finally do teste.
 */
function mockFetch(status, body = {}) {
  const original = global.fetch;
  global.fetch = async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  });
  return () => { global.fetch = original; };
}

/**
 * Força rdService._isEnabled() a retornar true, independente das constantes
 * capturadas no load do módulo.
 * Retorna função de restore.
 */
function enableService() {
  const original = rdService._isEnabled;
  rdService._isEnabled = () => true;
  return () => { rdService._isEnabled = original; };
}

/**
 * Força rdService.sendConversion() a retornar o valor especificado.
 * Retorna função de restore.
 */
function mockSendConversion(returnValue) {
  const original = rdService.sendConversion;
  rdService.sendConversion = async () => returnValue;
  return () => { rdService.sendConversion = original; };
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

// ── Sessão de teste padrão ────────────────────────────────────────────────────
const baseSession = {
  phoneNumber: 'whatsapp:+5511999999999',
  name:        'Julio Ramos',
  email:       'julio@essencial.com',
  phone:       '(11) 99999-0001',
  document:    '11222333000181',
  companyName: 'Essencial Energia',
  segment:     'venda',
  isIcp:       true,
  qualificationData: {
    kvaRange:       3,
    contractType:   null,
    equipmentBrand: null,
    equipmentModel: null,
  },
};

// =============================================================================
// Suite 1 — rdStationService: sendConversion e buildRdPayload
// =============================================================================
describe('rdStationService', () => {

  it('sendConversion() retorna { success: false, reason: "disabled" } quando _isEnabled() = false', async () => {
    const origEnabled = rdService._isEnabled;
    rdService._isEnabled = () => false;
    try {
      const result = await rdService.sendConversion(baseSession);
      assert.equal(result.success, false);
      assert.equal(result.reason, 'disabled');
    } finally { rdService._isEnabled = origEnabled; }
  });

  it('sendConversion() retorna { success: true, status: 200 } com fetch bem-sucedido', async () => {
    const restoreEnable = enableService();
    const restoreFetch  = mockFetch(200, { event_uuid: 'abc-123' });
    try {
      const result = await rdService.sendConversion(baseSession);
      assert.equal(result.success, true);
      assert.equal(result.status, 200);
    } finally { restoreFetch(); restoreEnable(); }
  });

  it('sendConversion() aceita HTTP 201 como sucesso', async () => {
    const restoreEnable = enableService();
    const restoreFetch  = mockFetch(201, { event_uuid: 'xyz-999' });
    try {
      const result = await rdService.sendConversion(baseSession);
      assert.equal(result.success, true);
      assert.equal(result.status, 201);
    } finally { restoreFetch(); restoreEnable(); }
  });

  it('sendConversion() retorna { success: false, status: 400 } em resposta de erro HTTP', async () => {
    const restoreEnable = enableService();
    const restoreFetch  = mockFetch(400, { errors: ['Bad Request'] });
    try {
      const result = await rdService.sendConversion(baseSession);
      assert.equal(result.success, false);
      assert.equal(result.status, 400);
    } finally { restoreFetch(); restoreEnable(); }
  });

  it('sendConversion() retorna { success: false, error } em timeout/exceção de fetch', async () => {
    const restoreEnable = enableService();
    const original = global.fetch;
    global.fetch = async () => { throw new Error('network failure'); };
    try {
      const result = await rdService.sendConversion(baseSession);
      assert.equal(result.success, false);
      assert.ok(result.error, 'deve conter campo error');
    } finally { global.fetch = original; restoreEnable(); }
  });

  it('buildRdPayload() mapeia campos obrigatórios da session', () => {
    const payload = rdService.buildRdPayload(baseSession);
    assert.equal(payload.email,        baseSession.email);
    assert.equal(payload.name,         baseSession.name);
    assert.equal(payload.personal_phone, baseSession.phone);
    assert.equal(payload.mobile_phone,   baseSession.phone);
    assert.equal(payload.company_name,   baseSession.companyName);
    assert.equal(payload.cf_cpf_cnpj,    baseSession.document);
  });

  it('buildRdPayload() usa label textual para kvaRange e contractType', () => {
    const session = { ...baseSession, qualificationData: { kvaRange: 1, contractType: 2 } };
    const payload = rdService.buildRdPayload(session);
    assert.equal(payload.cf_potencia_kva,  'Até 50 kVA');
    assert.equal(payload.cf_tipo_contrato, 'Prime/Contínua');
  });

  it('buildRdPayload() inclui tags com segmento e qualificado', () => {
    const payload = rdService.buildRdPayload(baseSession);
    assert.ok(Array.isArray(payload.tags));
    assert.ok(payload.tags.includes('whatsapp'));
    assert.ok(payload.tags.includes('venda'));
    assert.ok(payload.tags.includes('qualificado'));
  });

  it('buildRdPayload() usa tag "fora_do_icp" quando isIcp=false', () => {
    const payload = rdService.buildRdPayload({ ...baseSession, isIcp: false });
    assert.ok(payload.tags.includes('fora_do_icp'));
    assert.ok(!payload.tags.includes('qualificado'));
  });

  it('buildRdPayload() omite campos null/undefined', () => {
    const session = {
      ...baseSession,
      document:    undefined,
      companyName: null,
      qualificationData: {},
    };
    const payload = rdService.buildRdPayload(session);
    assert.ok(!('cf_cpf_cnpj'      in payload), 'cf_cpf_cnpj deve ser omitido');
    assert.ok(!('company_name'      in payload), 'company_name deve ser omitido');
    assert.ok(!('cf_potencia_kva'   in payload), 'cf_potencia_kva deve ser omitido');
    assert.ok(!('cf_tipo_contrato'  in payload), 'cf_tipo_contrato deve ser omitido');
    assert.ok(!('cf_marca_gerador'  in payload), 'cf_marca_gerador deve ser omitido');
    assert.ok(!('cf_modelo_gerador' in payload), 'cf_modelo_gerador deve ser omitido');
  });

});

// =============================================================================
// Suite 2 — rdStationRepository: lógica de sincronização e auditoria
// =============================================================================
describe('rdStationRepository', () => {

  it('syncLeadToRD() retorna skipped quando is_icp=false e sem opt-in', async () => {
    const result = await syncLeadToRD(
      { isIcp: false, optInNewsletter: false, email: 'j@test.com' }, 1
    );
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'not ICP and no newsletter opt-in');
  });

  it('syncLeadToRD() retorna skipped quando e-mail inválido', async () => {
    const result = await syncLeadToRD(
      { isIcp: true, email: 'invalido-sem-arroba' }, 2
    );
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'invalid email');
  });

  it('syncLeadToRD() retorna skipped quando sendConversion retorna disabled', async () => {
    const restore = mockSendConversion({ success: false, reason: 'disabled' });
    try {
      const result = await syncLeadToRD(
        { isIcp: true, email: 'j@test.com', ...baseSession }, 3
      );
      assert.equal(result.skipped, true);
      assert.equal(result.reason, 'RD disabled');
    } finally { restore(); }
  });

  it('syncLeadToRD() retorna { synced: true } quando sendConversion retorna sucesso', async () => {
    const restoreConv = mockSendConversion({ success: true, status: 200 });
    const { restore: restorePool } = mockPool({
      'UPDATE leads':         [],
      'INSERT INTO rd_sync_logs': [],
    });
    try {
      const result = await syncLeadToRD(
        { ...baseSession, isIcp: true, email: 'j@test.com' }, 4
      );
      assert.equal(result.synced, true);
      assert.equal(result.action, 'conversion');
    } finally { restoreConv(); restorePool(); }
  });

  it('syncLeadToRD() retorna { synced: false } quando sendConversion retorna HTTP error', async () => {
    const restoreConv = mockSendConversion({ success: false, status: 500 });
    const { restore: restorePool } = mockPool({
      'UPDATE leads':         [],
      'INSERT INTO rd_sync_logs': [],
    });
    try {
      const result = await syncLeadToRD(
        { ...baseSession, isIcp: true, email: 'j@test.com' }, 5
      );
      assert.equal(result.synced, false);
      assert.ok(result.error, 'deve conter campo error');
    } finally { restoreConv(); restorePool(); }
  });

  it('syncLeadToRD() relança exceção quando sendConversion lança erro', async () => {
    const original = rdService.sendConversion;
    rdService.sendConversion = async () => { throw new Error('rede indisponível'); };
    const { restore: restorePool } = mockPool({
      'UPDATE leads':         [],
      'INSERT INTO rd_sync_logs': [],
    });
    try {
      await assert.rejects(
        () => syncLeadToRD({ ...baseSession, isIcp: true, email: 'j@test.com' }, 6),
        /rede indisponível/
      );
    } finally { rdService.sendConversion = original; restorePool(); }
  });

  it('logRDSync() insere registro de auditoria em rd_sync_logs', async () => {
    const { log, restore } = mockPool({ 'INSERT INTO rd_sync_logs': [] });
    try {
      await logRDSync(10, 'conversion', { email: 'j@test.com' }, { success: true }, null);
      const q = log.find(q => q.sql.includes('INSERT INTO rd_sync_logs'));
      assert.ok(q, 'deve executar INSERT em rd_sync_logs');
      assert.equal(q.params[0], 10,           'lead_id correto');
      assert.equal(q.params[1], 'conversion', 'action correto');
      assert.equal(q.params[4], null,         'error_message deve ser null no sucesso');
    } finally { restore(); }
  });

  it('syncLeadToRD() persiste rd_sync_status=error quando sendConversion falha', async () => {
    const original = rdService.sendConversion;
    rdService.sendConversion = async () => { throw new Error('RD timeout simulado'); };
    const { log, restore: restorePool } = mockPool({
      'UPDATE leads':         [],
      'INSERT INTO rd_sync_logs': [],
    });
    try {
      await assert.rejects(
        () => syncLeadToRD({ ...baseSession, isIcp: true, email: 'j@test.com' }, 12),
        /RD timeout simulado/
      );
      const updateQuery = log.find(q => q.sql.includes('UPDATE leads'));
      assert.ok(updateQuery, 'deve ter chamado UPDATE leads');
      assert.ok(
        updateQuery.params.includes('error'),
        `rd_sync_status deve ser "error", params: ${JSON.stringify(updateQuery.params)}`
      );
      const insertQuery = log.find(q => q.sql.includes('INSERT INTO rd_sync_logs'));
      assert.ok(insertQuery, 'deve ter inserido em rd_sync_logs mesmo com erro');
    } finally { rdService.sendConversion = original; restorePool(); }
  });

});

// =============================================================================
// Suite 3 — botHandler: fire-and-forget não bloqueia o fluxo
// =============================================================================
describe('botHandler — fire-and-forget RD Station', () => {

  it('fluxo completo funciona quando _isEnabled() = false', async () => {
    const origEnabled = rdService._isEnabled;
    rdService._isEnabled = () => false;
    const phone = nextPhone();
    try {
      const responses = await converse(phone, [
        'oi', 'Test RD Off', '52998224725', 'rdoff@test.com', '11900000001',
        '1',             // venda
        'Curitiba, PR',  // localização
        '3',             // kVA ≥ 100 kVA (qualificado)
      ]);
      const closing = responses[7][0];
      assert.ok(closing.includes('entrará em contato'), 'deve confirmar contato mesmo com RD desabilitado');
    } finally { rdService._isEnabled = origEnabled; }
  });

  it('fluxo completo funciona quando sendConversion lança exceção (sem banco, fire-and-forget)', async () => {
    const restoreEnable = enableService();
    const original = rdService.sendConversion;
    rdService.sendConversion = async () => { throw new Error('RD fora do ar simulado'); };

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
    } finally { rdService.sendConversion = original; restoreEnable(); }
  });

  it('fire-and-forget: RD erro não bloqueia quando banco está disponível', async () => {
    const restoreEnable = enableService();
    const { restore: restorePool } = mockPool({
      'INSERT INTO leads':        [{ id: 99 }],
      'UPDATE leads':             [],
      'INSERT INTO rd_sync_logs': [],
      'INSERT INTO sessions':     [],
    });
    const original = rdService.sendConversion;
    rdService.sendConversion = async () => { throw new Error('RD indisponível'); };

    const phone = nextPhone();
    try {
      const responses = await converse(phone, [
        'oi', 'Test Bank Fire', '52998224725', 'bff@test.com', '11900000003',
        '1',             // venda
        'Salvador, BA',  // localização
        '3',             // kVA qualificado
      ]);
      const closing = responses[7][0];
      assert.ok(
        closing.includes('entrará em contato') || closing.includes('equipe'),
        'bot deve encerrar normalmente mesmo com RD falhando'
      );
    } finally { rdService.sendConversion = original; restorePool(); restoreEnable(); }
  });

});
