const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// Garante que nenhum teste toque em banco real
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;
process.env.BOT_CLOSE_TIMEOUT_MIN = '40';
process.env.CNPJ_API_URL = '';

const {
  saveLead,
  saveSession,
  findLeadByPhone,
  findLeadByDocument,
  listLeads,
  countLeads,
} = require('../src/database/leadRepository');

const session = {
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
  errorCount: 0,
  qualificationData: { kvaRange: 3, contractType: null, equipmentBrand: null, equipmentModel: null },
  step: 'closing',
  completed: true,
  createdAt: Date.now() - 30000,
};

// ─── Degradação graciosa ──────────────────────────────────────────────────────
describe('leadRepository — sem banco disponível', () => {
  it('saveLead retorna null', async () => {
    const result = await saveLead(session);
    assert.equal(result, null);
  });

  it('saveSession retorna null', async () => {
    const result = await saveSession(session.phoneNumber, session, null);
    assert.equal(result, null);
  });

  it('findLeadByPhone retorna null', async () => {
    const result = await findLeadByPhone('whatsapp:+5511999990001');
    assert.equal(result, null);
  });

  it('findLeadByDocument retorna null', async () => {
    const result = await findLeadByDocument('11222333000181');
    assert.equal(result, null);
  });

  it('listLeads retorna array vazio', async () => {
    const result = await listLeads({ segment: 'venda' });
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  it('countLeads retorna null', async () => {
    const result = await countLeads({ is_icp: true });
    assert.equal(result, null);
  });

  it('nenhuma função lança exceção', async () => {
    await assert.doesNotReject(() => saveLead(session));
    await assert.doesNotReject(() => saveSession(session.phoneNumber, session));
    await assert.doesNotReject(() => findLeadByPhone('whatsapp:+5511999990001'));
    await assert.doesNotReject(() => findLeadByDocument('11222333000181'));
    await assert.doesNotReject(() => listLeads());
    await assert.doesNotReject(() => countLeads());
  });
});

// ─── Integração com botHandler ────────────────────────────────────────────────
describe('botHandler — persistência fire-and-forget não quebra fluxo', () => {
  const { handleMessage } = require('../src/handlers/botHandler');

  let phoneCounter = 9000;
  const nextPhone = () => `whatsapp:+550000${String(phoneCounter++).padStart(7, '0')}`;

  async function converse(phone, steps) {
    const responses = [];
    for (const body of steps) {
      const replies = await handleMessage(phone, body, 'Test');
      responses.push(replies);
    }
    return responses;
  }

  it('fluxo venda qualificada completa sem erro (sem banco)', async () => {
    const phone = nextPhone();
    await assert.doesNotReject(() =>
      converse(phone, ['oi', 'Julio Ramos', '52998224725', 'julio@t.com', '11999990001', '1', '3'])
    );
  });

  it('fluxo locação completa sem erro (sem banco)', async () => {
    const phone = nextPhone();
    await assert.doesNotReject(() =>
      converse(phone, ['oi', 'Ana Lima', '52998224725', 'ana@t.com', '11988880002', '2', '1'])
    );
  });

  it('fluxo manutenção completa sem erro (sem banco)', async () => {
    const phone = nextPhone();
    await assert.doesNotReject(() =>
      converse(phone, ['oi', 'Carlos Tech', '52998224725', 'carlos@t.com', '11977770003', '3', 'Cummins', 'C150 D6'])
    );
  });

  it('fluxo fora do ICP sem erro (sem banco)', async () => {
    const phone = nextPhone();
    await assert.doesNotReject(() =>
      converse(phone, ['oi', 'Maria Fora', '52998224725', 'maria@t.com', '11966660004', '1', '1', '1'])
    );
  });

  it('resposta do bot não é afetada pela ausência do banco', async () => {
    const phone = nextPhone();
    const responses = await converse(phone, [
      'oi', 'Pedro Teste', '52998224725', 'pedro@t.com', '11955550005', '1', '4',
    ]);
    const closing = responses[6][0];
    assert.ok(closing.includes('entrará em contato'), 'mensagem de encerramento deve ser entregue');
    assert.ok(closing.includes('Pedro Teste'), 'nome do lead deve estar no resumo');
  });
});
