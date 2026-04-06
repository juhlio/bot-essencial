const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// Desativa chamadas externas nos testes
process.env.CNPJ_API_URL = '';
process.env.BOT_CLOSE_TIMEOUT_MIN = '40';
delete process.env.REDIS_URL;

const { handleMessage } = require('../src/handlers/botHandler');

// Cada teste usa um número único para evitar interferência de estado
let phoneCounter = 1000;
function nextPhone() {
  return `whatsapp:+550000${String(phoneCounter++).padStart(7, '0')}`;
}

// Executa uma sequência de mensagens e retorna todas as respostas
async function converse(phone, steps) {
  const responses = [];
  for (const body of steps) {
    const replies = await handleMessage(phone, body, 'Test');
    responses.push(replies);
  }
  return responses;
}

// ─── Venda qualificada ────────────────────────────────────────────────────────
describe('Fluxo: Venda qualificada (CNPJ)', () => {
  it('percorre todo o fluxo e encerra com mensagem comercial', async () => {
    const phone = nextPhone();
    const responses = await converse(phone, [
      'oi',                   // greeting
      'Julio Ramos',          // nome
      '11222333000181',       // CNPJ válido
      'julio@essencial.com',  // email
      '11999990001',          // telefone
      '1',                    // segmento: venda
      'São Paulo, SP',        // localização
      '3',                    // kVA: 100-200 kVA (qualificado)
    ]);

    const closing = responses[7][0];
    assert.ok(closing.includes('comercial'), 'deve mencionar equipe comercial');
    assert.ok(closing.includes('entrará em contato'), 'deve confirmar contato');
    assert.ok(closing.includes('Julio Ramos'), 'deve incluir o nome no resumo');
  });
});

// ─── Lead fora do ICP ─────────────────────────────────────────────────────────
describe('Fluxo: Lead fora do ICP (kVA < 50)', () => {
  it('exibe mensagem de fora do ICP ao escolher opção 1 no kVA', async () => {
    const phone = nextPhone();
    const responses = await converse(phone, [
      'oi',
      'Ana Silva',
      '52998224725',
      'ana@test.com',
      '11988880002',
      '1',             // segmento: venda
      'Campinas, SP',  // localização
      '1',             // kVA: até 50 kVA → fora do ICP
    ]);

    const outOfIcpMsg = responses[7][0];
    assert.ok(outOfIcpMsg.includes('50 kVA'), 'deve mencionar limite de 50 kVA');
  });

  it('confirma cadastro na newsletter ao escolher opt-in 1', async () => {
    const phone = nextPhone();
    const responses = await converse(phone, [
      'oi',
      'Ana Silva',
      '52998224725',
      'ana@test.com',
      '11988880002',
      '1',             // segmento: venda
      'Campinas, SP',  // localização
      '1',             // fora do ICP
      '1',             // opt-in: sim
    ]);

    const optInMsg = responses[8][0];
    assert.ok(optInMsg.includes('cadastrado'), 'deve confirmar cadastro na lista');
  });
});

// ─── Locação ──────────────────────────────────────────────────────────────────
describe('Fluxo: Locação', () => {
  it('encerra com mensagem de encerramento ao concluir locação', async () => {
    const phone = nextPhone();
    const responses = await converse(phone, [
      'oi',
      'Carlos Lima',
      '52998224725',
      'carlos@test.com',
      '11977770003',
      '2',                    // segmento: locação
      'Rio de Janeiro, RJ',   // localização
      '1',                    // contrato: stand-by
    ]);

    const closing = responses[7][0];
    assert.ok(closing.includes('entrará em contato'), 'deve confirmar contato');
    assert.ok(closing.includes('Carlos Lima'), 'deve incluir o nome no resumo');
    assert.ok(closing.includes('Locação'), 'deve mencionar Locação no resumo');
  });
});

// ─── Manutenção ───────────────────────────────────────────────────────────────
describe('Fluxo: Manutenção', () => {
  it('encerra com mensagem de encerramento ao concluir manutenção', async () => {
    const phone = nextPhone();
    const responses = await converse(phone, [
      'oi',
      'Maria Costa',
      '52998224725',
      'maria@test.com',
      '11966660004',
      '3',            // segmento: manutenção
      'Brasília, DF', // localização
      'Cummins',      // marca
      'C150 D6',      // modelo
    ]);

    const closing = responses[8][0];
    assert.ok(closing.includes('técnica'), 'deve mencionar equipe técnica');
    assert.ok(closing.includes('Cummins C150 D6'), 'deve incluir marca e modelo');
    assert.ok(closing.includes('Maria Costa'), 'deve incluir o nome no resumo');
  });
});

// ─── Localização ─────────────────────────────────────────────────────────────
describe('Fluxo: Localização (awaiting_location)', () => {
  // Sequência base até o step de localização
  async function converseUntilLocation(phone, segmento) {
    await converse(phone, [
      'oi',
      'Pedro Teste',
      '52998224725',
      'pedro@test.com',
      '11944440001',
      segmento,
    ]);
  }

  it('venda com location válida avança para pergunta de kVA', async () => {
    const phone = nextPhone();
    await converseUntilLocation(phone, '1');
    const replies = await handleMessage(phone, 'São Paulo, SP', 'Test');
    assert.ok(replies[0].includes('kVA') || replies[0].includes('potência'), 'deve perguntar faixa de kVA');
  });

  it('locação com location válida avança para pergunta de contrato', async () => {
    const phone = nextPhone();
    await converseUntilLocation(phone, '2');
    const replies = await handleMessage(phone, 'Rio de Janeiro, RJ', 'Test');
    assert.ok(replies[0].includes('contrato') || replies[0].includes('locação'), 'deve perguntar tipo de contrato');
  });

  it('manutenção com location válida avança para pergunta de marca', async () => {
    const phone = nextPhone();
    await converseUntilLocation(phone, '3');
    const replies = await handleMessage(phone, 'Brasília, DF', 'Test');
    assert.ok(replies[0].includes('marca') || replies[0].includes('equipamento'), 'deve perguntar marca do equipamento');
  });

  it('location inválida (< 3 caracteres) retorna mensagem de erro', async () => {
    const phone = nextPhone();
    await converseUntilLocation(phone, '1');
    const replies = await handleMessage(phone, 'SP', 'Test');
    assert.ok(!replies[0].includes('kVA'), 'não deve avançar para kVA');
    assert.ok(replies[0].length > 0, 'deve retornar mensagem de erro');
  });

  it('location com números retorna mensagem de erro', async () => {
    const phone = nextPhone();
    await converseUntilLocation(phone, '1');
    const replies = await handleMessage(phone, 'São Paulo 123', 'Test');
    assert.ok(!replies[0].includes('kVA'), 'não deve avançar para kVA');
    assert.ok(replies[0].includes('números'), 'deve mencionar o problema com números');
  });
});

// ─── maxErrors ────────────────────────────────────────────────────────────────
describe('Controle de erros', () => {
  it('exibe maxErrors após 3 entradas inválidas consecutivas no mesmo step', async () => {
    const phone = nextPhone();
    await handleMessage(phone, 'oi', 'Test'); // greeting → awaiting_name

    let lastReplies;
    for (let i = 0; i < 3; i++) {
      lastReplies = await handleMessage(phone, 'ab', 'Test'); // nome inválido (< 3 chars)
    }

    assert.equal(lastReplies.length, 2, 'deve retornar 2 mensagens: erro + maxErrors');
    assert.ok(lastReplies[1].includes('0800 779 9009'), 'segunda mensagem deve ser maxErrors com telefone');
  });

  it('reseta stepErrorCount ao avançar de step', async () => {
    const phone = nextPhone();
    await handleMessage(phone, 'oi', 'Test');

    // 2 erros no step awaiting_name
    await handleMessage(phone, 'ab', 'Test');
    await handleMessage(phone, 'ab', 'Test');

    // nome válido — avança de step
    const replies = await handleMessage(phone, 'Pedro Santos', 'Test');
    assert.ok(replies[0].includes('CNPJ ou CPF'), 'deve avançar para askDocument');
  });
});

// ─── Comando reiniciar ────────────────────────────────────────────────────────
describe('Comando de reset', () => {
  it('"reiniciar" reseta a sessão e retorna greeting', async () => {
    const phone = nextPhone();
    await handleMessage(phone, 'oi', 'Test');
    await handleMessage(phone, 'Fernando', 'Test'); // avança o step

    const replies = await handleMessage(phone, 'reiniciar', 'Test');

    assert.equal(replies.length, 2, 'deve retornar restart + greeting');
    assert.ok(replies[0].includes('recomeçar') || replies[0].includes('recomeçar') || replies[0].toLowerCase().includes('sem problemas'), 'primeira mensagem deve ser restart');
    assert.ok(replies[1].includes('Bem-vindo'), 'segunda mensagem deve ser greeting');
  });

  it('"menu" também reseta a sessão', async () => {
    const phone = nextPhone();
    await handleMessage(phone, 'oi', 'Test');

    const replies = await handleMessage(phone, 'menu', 'Test');
    assert.ok(replies.some(r => r.includes('Bem-vindo')), 'deve retornar greeting');
  });

  it('sessão completed reinicia automaticamente na próxima mensagem', async () => {
    const phone = nextPhone();
    // Percorre fluxo completo até completar
    await converse(phone, [
      'oi', 'João Teste', '52998224725',
      'joao@test.com', '11955550005', '1', 'Curitiba, PR', '4',
    ]);

    // Nova mensagem após completed
    const replies = await handleMessage(phone, 'oi', 'Test');
    assert.ok(replies[0].includes('Bem-vindo'), 'deve reiniciar com greeting');
  });
});
