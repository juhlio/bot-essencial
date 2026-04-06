const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  isValidCPF,
  isValidCNPJ,
  detectDocumentType,
  isValidEmail,
  isValidPhone,
  formatPhone,
  isValidOption,
  validateLocation,
} = require('../src/validators/validators');

// ─── CPF ─────────────────────────────────────────────────────────────────────
describe('isValidCPF', () => {
  it('aceita CPF válido com formatação', () => {
    assert.equal(isValidCPF('529.982.247-25'), true);
  });

  it('aceita CPF válido sem formatação', () => {
    assert.equal(isValidCPF('52998224725'), true);
  });

  it('rejeita sequência repetida (111.111.111-11)', () => {
    assert.equal(isValidCPF('111.111.111-11'), false);
  });

  it('rejeita sequência repetida (000.000.000-00)', () => {
    assert.equal(isValidCPF('000.000.000-00'), false);
  });

  it('rejeita CPF com dígito verificador errado', () => {
    assert.equal(isValidCPF('529.982.247-26'), false);
  });

  it('rejeita string aleatória', () => {
    assert.equal(isValidCPF('123456789'), false);
  });
});

// ─── CNPJ ────────────────────────────────────────────────────────────────────
describe('isValidCNPJ', () => {
  it('aceita CNPJ válido com formatação', () => {
    assert.equal(isValidCNPJ('11.222.333/0001-81'), true);
  });

  it('aceita CNPJ válido sem formatação', () => {
    assert.equal(isValidCNPJ('11222333000181'), true);
  });

  it('rejeita sequência repetida (00.000.000/0000-00)', () => {
    assert.equal(isValidCNPJ('00.000.000/0000-00'), false);
  });

  it('rejeita sequência repetida (11.111.111/1111-11)', () => {
    assert.equal(isValidCNPJ('11.111.111/1111-11'), false);
  });

  it('rejeita CNPJ com dígito verificador errado', () => {
    assert.equal(isValidCNPJ('11.222.333/0001-82'), false);
  });

  it('rejeita string aleatória', () => {
    assert.equal(isValidCNPJ('12345678000100'), false);
  });
});

// ─── detectDocumentType ──────────────────────────────────────────────────────
describe('detectDocumentType', () => {
  it('retorna "cpf" para 11 dígitos', () => {
    assert.equal(detectDocumentType('529.982.247-25'), 'cpf');
  });

  it('retorna "cpf" para 11 dígitos sem formatação', () => {
    assert.equal(detectDocumentType('52998224725'), 'cpf');
  });

  it('retorna "cnpj" para 14 dígitos', () => {
    assert.equal(detectDocumentType('11.222.333/0001-81'), 'cnpj');
  });

  it('retorna "cnpj" para 14 dígitos sem formatação', () => {
    assert.equal(detectDocumentType('11222333000181'), 'cnpj');
  });

  it('retorna null para menos de 11 dígitos', () => {
    assert.equal(detectDocumentType('123'), null);
  });

  it('retorna null para 12 ou 13 dígitos', () => {
    assert.equal(detectDocumentType('123456789012'), null);
  });
});

// ─── isValidEmail ────────────────────────────────────────────────────────────
describe('isValidEmail', () => {
  it('aceita email simples', () => {
    assert.equal(isValidEmail('user@example.com'), true);
  });

  it('aceita email com subdomínio', () => {
    assert.equal(isValidEmail('user@mail.example.com.br'), true);
  });

  it('rejeita sem arroba', () => {
    assert.equal(isValidEmail('userexample.com'), false);
  });

  it('rejeita sem domínio', () => {
    assert.equal(isValidEmail('user@'), false);
  });

  it('rejeita com espaço', () => {
    assert.equal(isValidEmail('user @example.com'), false);
  });

  it('rejeita string vazia', () => {
    assert.equal(isValidEmail(''), false);
  });
});

// ─── isValidPhone ────────────────────────────────────────────────────────────
describe('isValidPhone', () => {
  it('aceita celular com 11 dígitos com formatação', () => {
    assert.equal(isValidPhone('(11) 99999-4444'), true);
  });

  it('aceita fixo com 10 dígitos com formatação', () => {
    assert.equal(isValidPhone('(11) 3333-4444'), true);
  });

  it('aceita 11 dígitos sem formatação', () => {
    assert.equal(isValidPhone('11999994444'), true);
  });

  it('aceita 10 dígitos sem formatação', () => {
    assert.equal(isValidPhone('1133334444'), true);
  });

  it('rejeita menos de 10 dígitos', () => {
    assert.equal(isValidPhone('123456'), false);
  });

  it('rejeita mais de 11 dígitos', () => {
    assert.equal(isValidPhone('119999944440'), false);
  });
});

// ─── formatPhone ─────────────────────────────────────────────────────────────
describe('formatPhone', () => {
  it('formata celular (11 dígitos)', () => {
    assert.equal(formatPhone('11999994444'), '(11) 99999-4444');
  });

  it('formata fixo (10 dígitos)', () => {
    assert.equal(formatPhone('1133334444'), '(11) 3333-4444');
  });

  it('formata removendo caracteres não numéricos', () => {
    assert.equal(formatPhone('(11) 99999-4444'), '(11) 99999-4444');
  });
});

// ─── isValidOption ───────────────────────────────────────────────────────────
describe('isValidOption', () => {
  it('aceita opção no limite inferior', () => {
    assert.equal(isValidOption('1', 1, 3), true);
  });

  it('aceita opção no limite superior', () => {
    assert.equal(isValidOption('3', 1, 3), true);
  });

  it('aceita opção no meio do range', () => {
    assert.equal(isValidOption('2', 1, 3), true);
  });

  it('rejeita opção abaixo do limite', () => {
    assert.equal(isValidOption('0', 1, 3), false);
  });

  it('rejeita opção acima do limite', () => {
    assert.equal(isValidOption('4', 1, 3), false);
  });

  it('rejeita string não numérica', () => {
    assert.equal(isValidOption('abc', 1, 3), false);
  });

  it('aceita "1.5" como 1 via parseInt (comportamento esperado do bot)', () => {
    assert.equal(isValidOption('1.5', 1, 3), true);
  });
});

// ─── validateLocation ────────────────────────────────────────────────────────
describe('validateLocation', () => {
  it('retorna válido para "São Paulo, SP"', () => {
    const result = validateLocation('São Paulo, SP');
    assert.ok(result.isValid);
  });

  it('retorna inválido para "SP" (< 3 caracteres)', () => {
    const result = validateLocation('SP');
    assert.ok(!result.isValid);
    assert.ok(result.message.includes('curta') || result.message.includes('caracteres'));
  });

  it('retorna inválido para "São Paulo 123" (contém números)', () => {
    const result = validateLocation('São Paulo 123');
    assert.ok(!result.isValid);
    assert.ok(result.message.includes('números'));
  });

  it('retorna inválido para string vazia', () => {
    const result = validateLocation('');
    assert.ok(!result.isValid);
  });

  it('retorna inválido para "   " (apenas espaços)', () => {
    const result = validateLocation('   ');
    assert.ok(!result.isValid);
  });

  it('retorna válido para "Belo Horizonte, MG"', () => {
    const result = validateLocation('Belo Horizonte, MG');
    assert.ok(result.isValid);
  });

  it('retorna inválido para texto com > 100 caracteres', () => {
    const longText = 'A'.repeat(101);
    const result = validateLocation(longText);
    assert.ok(!result.isValid);
  });
});
