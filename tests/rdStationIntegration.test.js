const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Limpar variáveis RD ao iniciar — cada teste configura o que precisa
delete process.env.RD_STATION_ENABLED;
delete process.env.RD_STATION_API_KEY;
delete process.env.RD_STATION_CONVERSION_ID;
delete process.env.DATABASE_URL;

// ─── Helper: carrega o serviço com env limpa + overrides especificados ─────────
// Necessário porque API_KEY, ENABLED e CONVERSION_ID são constantes capturadas
// no momento do require() — apenas recarregar o módulo reflete novos valores.
function loadService(envVars = {}) {
  delete process.env.RD_STATION_ENABLED;
  delete process.env.RD_STATION_API_KEY;
  delete process.env.RD_STATION_CONVERSION_ID;

  for (const [k, v] of Object.entries(envVars)) {
    process.env[k] = v;
  }

  delete require.cache[require.resolve('../src/services/rdStationService')];
  return require('../src/services/rdStationService');
}

// ─── Session mock de referência ───────────────────────────────────────────────
const baseSession = {
  phoneNumber: 'whatsapp:+5511999990001',
  name: 'Julio Ramos',
  documentType: 'cnpj',
  document: '11222333000181',
  companyName: 'Essencial Energia',
  email: 'julio@essencial.com',
  phone: '(11) 99999-0001',
  segment: 'venda',
  isIcp: true,
  optInNewsletter: null,
  qualificationData: {
    kvaRange: 3,
    contractType: null,
    equipmentBrand: null,
    equipmentModel: null,
    location: 'São Paulo, SP',
  },
};

// =============================================================================
// Suite 1 — _isEnabled / configuração
// =============================================================================
describe('_isEnabled / configuração', () => {

  it('retorna false quando RD_STATION_ENABLED não está definido', () => {
    const svc = loadService(); // sem nenhuma variável
    assert.equal(svc._isEnabled(), false);
  });

  it('retorna false quando RD_STATION_ENABLED=false mesmo com API_KEY definida', () => {
    const svc = loadService({ RD_STATION_ENABLED: 'false', RD_STATION_API_KEY: 'qualquer-chave' });
    assert.equal(svc._isEnabled(), false);
  });

  it('retorna false quando RD_STATION_ENABLED=true mas RD_STATION_API_KEY está vazia', () => {
    const svc = loadService({ RD_STATION_ENABLED: 'true' }); // sem API_KEY
    assert.equal(svc._isEnabled(), false);
  });

});

// =============================================================================
// Suite 2 — buildRdPayload: mapeamento de campos
// =============================================================================
describe('buildRdPayload — mapeamento de campos', () => {

  it('monta payload correto para lead de venda qualificada (kvaRange=3)', () => {
    const svc = loadService();
    const payload = svc.buildRdPayload(baseSession);

    assert.equal(payload.email,          'julio@essencial.com', 'email');
    assert.equal(payload.name,           'Julio Ramos',         'name');
    assert.equal(payload.personal_phone, '(11) 99999-0001',     'personal_phone');
    assert.equal(payload.mobile_phone,   '(11) 99999-0001',     'mobile_phone');
    assert.equal(payload.cf_cpf_cnpj,    '11222333000181',      'cf_cpf_cnpj');
    assert.equal(payload.cf_potencia_kva, 'De 100 a 200 kVA',  'cf_potencia_kva');
  });

  it('monta payload correto para lead de locação (contractType=2)', () => {
    const svc = loadService();
    const session = {
      ...baseSession,
      segment: 'locacao',
      qualificationData: { kvaRange: null, contractType: 2, equipmentBrand: null, equipmentModel: null },
    };
    const payload = svc.buildRdPayload(session);

    assert.equal(payload.cf_tipo_contrato, 'Prime/Contínua');
    assert.ok(!('cf_potencia_kva' in payload), 'kvaRange nulo não deve gerar cf_potencia_kva');
  });

  it('monta payload correto para lead de manutenção (brand + model)', () => {
    const svc = loadService();
    const session = {
      ...baseSession,
      segment: 'manutencao',
      qualificationData: {
        kvaRange: null, contractType: null,
        equipmentBrand: 'Cummins', equipmentModel: 'QSK60',
      },
    };
    const payload = svc.buildRdPayload(session);

    assert.equal(payload.cf_marca_gerador,  'Cummins');
    assert.equal(payload.cf_modelo_gerador, 'QSK60');
  });

  it('lead fora do ICP inclui tag "fora_do_icp" e não inclui "qualificado"', () => {
    const svc = loadService();
    const payload = svc.buildRdPayload({ ...baseSession, isIcp: false });

    assert.ok(payload.tags.includes('fora_do_icp'), 'deve conter fora_do_icp');
    assert.ok(!payload.tags.includes('qualificado'), 'não deve conter qualificado');
  });

  it('lead qualificado inclui tag "qualificado" e não inclui "fora_do_icp"', () => {
    const svc = loadService();
    const payload = svc.buildRdPayload(baseSession); // isIcp: true

    assert.ok(payload.tags.includes('qualificado'),  'deve conter qualificado');
    assert.ok(!payload.tags.includes('fora_do_icp'), 'não deve conter fora_do_icp');
  });

  it('campos null/undefined NÃO aparecem no payload', () => {
    const svc = loadService();
    const session = {
      ...baseSession,
      document:    null,
      companyName: undefined,
      phone:       null,
      qualificationData: {}, // sem kvaRange, contractType, brand, model
    };
    const payload = svc.buildRdPayload(session);

    assert.ok(!('cf_cpf_cnpj'      in payload), 'cf_cpf_cnpj não deve aparecer');
    assert.ok(!('cf_empresa_lead'   in payload), 'cf_empresa_lead não deve aparecer');
    assert.ok(!('company_name'      in payload), 'company_name não deve aparecer');
    assert.ok(!('personal_phone'    in payload), 'personal_phone não deve aparecer');
    assert.ok(!('mobile_phone'      in payload), 'mobile_phone não deve aparecer');
    assert.ok(!('cf_potencia_kva'   in payload), 'cf_potencia_kva não deve aparecer');
    assert.ok(!('cf_tipo_contrato'  in payload), 'cf_tipo_contrato não deve aparecer');
    assert.ok(!('cf_marca_gerador'  in payload), 'cf_marca_gerador não deve aparecer');
    assert.ok(!('cf_modelo_gerador' in payload), 'cf_modelo_gerador não deve aparecer');
  });

  it('conversion_identifier usa o valor default "whatsapp-bot-essencial"', () => {
    const svc = loadService(); // sem RD_STATION_CONVERSION_ID
    const payload = svc.buildRdPayload(baseSession);

    assert.equal(payload.conversion_identifier, 'whatsapp-bot-essencial');
  });

  it('conversion_identifier usa o valor de RD_STATION_CONVERSION_ID quando definido', () => {
    const svc = loadService({ RD_STATION_CONVERSION_ID: 'bot-venda-essencial' });
    const payload = svc.buildRdPayload(baseSession);

    assert.equal(payload.conversion_identifier, 'bot-venda-essencial');
  });

});

// =============================================================================
// Suite 3 — sendConversion: degradação graciosa
// =============================================================================
describe('sendConversion — degradação graciosa', () => {

  it('retorna { success: false, reason: "disabled" } quando desabilitado, sem lançar erro', async () => {
    const svc = loadService(); // ENABLED=false, sem API_KEY
    const result = await svc.sendConversion(baseSession);

    assert.equal(result.success, false);
    assert.equal(result.reason,  'disabled');
  });

  it('não lança exceção com session incompleta (todos os campos null)', async () => {
    const svc = loadService(); // serviço desabilitado — retorno antecipado antes de usar a session
    const incompleteSession = {
      phoneNumber:       'whatsapp:+5511000000000',
      name:              null,
      email:             null,
      phone:             null,
      document:          null,
      companyName:       null,
      segment:           null,
      isIcp:             false,
      qualificationData: null,
    };

    let result;
    await assert.doesNotReject(async () => {
      result = await svc.sendConversion(incompleteSession);
    }, 'sendConversion não deve lançar exceção com session incompleta');

    assert.equal(typeof result, 'object', 'deve retornar um objeto');
    assert.ok('success' in result,        'resultado deve ter campo success');
  });

});
