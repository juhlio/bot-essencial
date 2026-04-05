const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Sem banco em todos os testes deste arquivo
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

const {
  resolveMessage,
  invalidateCache,
  populateCache,
} = require('../src/database/messageRepository');

const { SEED_MESSAGES } = require('../src/database/seedMessages');
const { getMessage } = require('../src/utils/messages');

// ─── resolveMessage sem banco ─────────────────────────────────────────────────
describe('messageRepository — sem banco disponível', () => {
  before(() => invalidateCache());

  it('resolveMessage retorna null quando cache está vazio (banco indisponível)', async () => {
    invalidateCache();
    const result = await resolveMessage('greeting');
    assert.equal(result, null);
  });

  it('invalidateCache limpa cache sem lançar exceção', () => {
    assert.doesNotThrow(() => invalidateCache());
  });

  it('invalidateCache pode ser chamado múltiplas vezes sem erro', () => {
    assert.doesNotThrow(() => {
      invalidateCache();
      invalidateCache();
      invalidateCache();
    });
  });
});

// ─── resolveMessage com cache populado ───────────────────────────────────────
describe('messageRepository — resolveMessage com cache', () => {
  before(() => {
    // Popula o cache com templates sintéticos para testar a lógica sem banco
    populateCache([
      {
        key: 'test_static',
        category: 'sistema',
        label: 'Teste estático',
        content: 'Mensagem sem variáveis',
        variables: [],
        is_dynamic: false,
      },
      {
        key: 'test_dynamic',
        category: 'identificacao',
        label: 'Teste dinâmico',
        content: 'Olá {{name}}, sua empresa é {{company}}.',
        variables: ['name', 'company'],
        is_dynamic: true,
      },
    ]);
  });

  after(() => invalidateCache());

  it('resolveMessage retorna conteúdo de template estático', async () => {
    const result = await resolveMessage('test_static');
    assert.equal(result, 'Mensagem sem variáveis');
  });

  it('resolveMessage substitui variáveis em template dinâmico', async () => {
    const result = await resolveMessage('test_dynamic', { name: 'Julio', company: 'Essencial' });
    assert.equal(result, 'Olá Julio, sua empresa é Essencial.');
  });

  it('resolveMessage com template estático ignora variáveis passadas', async () => {
    const result = await resolveMessage('test_static', { name: 'qualquer' });
    assert.equal(result, 'Mensagem sem variáveis');
  });

  it('resolveMessage com variável ausente mantém o placeholder', async () => {
    const result = await resolveMessage('test_dynamic', { name: 'Julio' });
    assert.ok(result.includes('Julio'));
    assert.ok(result.includes('{{company}}'));
  });

  it('resolveMessage retorna null para key inexistente mesmo com cache', async () => {
    const result = await resolveMessage('chave_que_nao_existe');
    assert.equal(result, null);
  });
});

// ─── Fallback via getMessage ──────────────────────────────────────────────────
describe('getMessage — fallback para hardcoded quando banco indisponível', () => {
  before(() => invalidateCache());

  it('todas as keys do SEED_MESSAGES são resolvidas via fallback', async () => {
    const dynamicKeys = new Set(['askDocument', 'documentFoundCNPJ', 'askSegment', 'outOfIcp', 'closing_footer']);
    for (const seed of SEED_MESSAGES) {
      const vars = {};
      if (dynamicKeys.has(seed.key)) {
        vars.name = 'Teste';
        vars.company = 'Empresa';
        vars.team = 'comercial';
      }
      const result = await getMessage(seed.key, vars);
      assert.ok(
        typeof result === 'string' && result.length > 0,
        `key "${seed.key}" deve retornar string não vazia via fallback`
      );
    }
  });

  it('getMessage retorna string vazia para key inexistente', async () => {
    const result = await getMessage('chave_inventada');
    assert.equal(typeof result, 'string');
  });

  it('getMessage substitui variável via fallback hardcoded', async () => {
    const result = await getMessage('askDocument', { name: 'Julio Ramos' });
    assert.ok(result.includes('Julio Ramos'), 'nome deve aparecer na mensagem');
  });

  it('getMessage retorna greeting sem variáveis', async () => {
    const result = await getMessage('greeting');
    assert.ok(result.includes('Essencial Energia'));
  });
});
