function isValidCPF(cpf) {
  const cleaned = cpf.replace(/\D/g, '');
  if (cleaned.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cleaned)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cleaned[i]) * (10 - i);
  let remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(cleaned[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cleaned[i]) * (11 - i);
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  return remainder === parseInt(cleaned[10]);
}

function isValidCNPJ(cnpj) {
  const cleaned = cnpj.replace(/\D/g, '');
  if (cleaned.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cleaned)) return false;

  const calc = (digits, weights) => {
    const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const digits = cleaned.split('').map(Number);
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  if (calc(digits.slice(0, 12), w1) !== digits[12]) return false;
  return calc(digits.slice(0, 13), w2) === digits[13];
}

function detectDocumentType(input) {
  const cleaned = input.replace(/\D/g, '');
  if (cleaned.length === 11) return 'cpf';
  if (cleaned.length === 14) return 'cnpj';
  return null;
}

function validateDocument(input) {
  const cleaned = input.replace(/\D/g, '');
  const type = detectDocumentType(input);

  if (!type) return { valid: false, type: null, cleaned: null };

  const valid = type === 'cpf' ? isValidCPF(cleaned) : isValidCNPJ(cleaned);
  return { valid, type, cleaned: valid ? cleaned : null };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.length === 10 || cleaned.length === 11;
}

function formatPhone(phone) {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11) {
    return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 7)}-${cleaned.slice(7)}`;
  }
  return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 6)}-${cleaned.slice(6)}`;
}

function isValidOption(input, min, max) {
  const n = parseInt(input, 10);
  return !isNaN(n) && Number.isInteger(n) && n >= min && n <= max;
}

function validateLocation(input) {
  const value = (input || '').trim();

  if (!value) {
    return { isValid: false, message: 'A localização não pode estar vazia.' };
  }
  if (value.length < 3) {
    return { isValid: false, message: 'A localização deve ter pelo menos 3 caracteres.' };
  }
  if (value.length > 100) {
    return { isValid: false, message: 'A localização deve ter no máximo 100 caracteres.' };
  }
  if (/\d/.test(value)) {
    return { isValid: false, message: 'A localização não deve conter números.' };
  }

  return { isValid: true };
}

module.exports = {
  isValidCPF,
  isValidCNPJ,
  detectDocumentType,
  validateDocument,
  isValidEmail,
  isValidPhone,
  formatPhone,
  isValidOption,
  validateLocation,
};

if (require.main === module) {
  const assert = (label, result, expected) => {
    const ok = result === expected;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: got ${result}, expected ${expected}`);
  };

  // CPF
  assert('CPF válido (529.982.247-25)', isValidCPF('529.982.247-25'), true);
  assert('CPF válido sem formatação', isValidCPF('52998224725'), true);
  assert('CPF inválido (sequência)', isValidCPF('111.111.111-11'), false);
  assert('CPF inválido (dígito errado)', isValidCPF('529.982.247-26'), false);

  // CNPJ
  assert('CNPJ válido (11.222.333/0001-81)', isValidCNPJ('11.222.333/0001-81'), true);
  assert('CNPJ válido sem formatação', isValidCNPJ('11222333000181'), true);
  assert('CNPJ inválido (sequência)', isValidCNPJ('11.111.111/1111-11'), false);
  assert('CNPJ inválido (dígito errado)', isValidCNPJ('11.222.333/0001-82'), false);

  // detectDocumentType
  assert('detectDocumentType CPF', detectDocumentType('529.982.247-25'), 'cpf');
  assert('detectDocumentType CNPJ', detectDocumentType('11.222.333/0001-81'), 'cnpj');
  assert('detectDocumentType null', detectDocumentType('123'), null);

  // validateDocument
  const r1 = validateDocument('529.982.247-25');
  assert('validateDocument CPF válido (valid)', r1.valid, true);
  assert('validateDocument CPF válido (type)', r1.type, 'cpf');

  // isValidEmail
  assert('email válido', isValidEmail('user@example.com'), true);
  assert('email inválido', isValidEmail('userexample.com'), false);

  // isValidPhone
  assert('telefone 10 dígitos', isValidPhone('(11) 3333-4444'), true);
  assert('telefone 11 dígitos', isValidPhone('(11) 99999-4444'), true);
  assert('telefone inválido', isValidPhone('123'), false);

  // formatPhone
  assert('formatPhone celular', formatPhone('11999994444'), '(11) 99999-4444');
  assert('formatPhone fixo', formatPhone('1133334444'), '(11) 3333-4444');

  // isValidOption
  assert('opção válida', isValidOption('2', 1, 3), true);
  assert('opção fora do range', isValidOption('5', 1, 3), false);
  assert('opção não numérica', isValidOption('abc', 1, 3), false);
}
