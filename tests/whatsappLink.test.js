const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── Replica a lógica de app.js (funções puras, sem dependência de browser) ────

function cleanPhoneNumber(phone) {
  return String(phone || '').replace(/^whatsapp:\+?/, '').replace(/\D/g, '');
}

function buildWhatsAppWebUrl(phone, text = 'Olá') {
  const number = cleanPhoneNumber(phone);
  return `https://web.whatsapp.com/send?phone=${number}&text=${encodeURIComponent(text)}`;
}

// ── cleanPhoneNumber ──────────────────────────────────────────────────────────
describe('cleanPhoneNumber', () => {
  it('remove prefixo "whatsapp:+"', () => {
    assert.equal(cleanPhoneNumber('whatsapp:+5541999990001'), '5541999990001');
  });

  it('remove prefixo "whatsapp:" sem o "+"', () => {
    assert.equal(cleanPhoneNumber('whatsapp:5541999990001'), '5541999990001');
  });

  it('remove somente "+" sem prefixo whatsapp', () => {
    assert.equal(cleanPhoneNumber('+5541999990001'), '5541999990001');
  });

  it('remove parênteses, traços e espaços', () => {
    assert.equal(cleanPhoneNumber('+55 (41) 99999-0001'), '5541999990001');
  });

  it('aceita número já limpo', () => {
    assert.equal(cleanPhoneNumber('5541999990001'), '5541999990001');
  });

  it('retorna string vazia para entrada vazia', () => {
    assert.equal(cleanPhoneNumber(''), '');
    assert.equal(cleanPhoneNumber(null), '');
    assert.equal(cleanPhoneNumber(undefined), '');
  });
});

// ── buildWhatsAppWebUrl ───────────────────────────────────────────────────────
describe('buildWhatsAppWebUrl', () => {
  it('gera URL correta para formato Twilio padrão', () => {
    const url = buildWhatsAppWebUrl('whatsapp:+5541999990001');
    assert.equal(url, 'https://web.whatsapp.com/send?phone=5541999990001&text=Ol%C3%A1');
  });

  it('usa domínio web.whatsapp.com/send', () => {
    const url = buildWhatsAppWebUrl('whatsapp:+5511999990002');
    assert.ok(url.startsWith('https://web.whatsapp.com/send'), 'deve usar WhatsApp Web');
  });

  it('inclui parâmetro phone sem prefixo nem caracteres especiais', () => {
    const url = buildWhatsAppWebUrl('whatsapp:+5541999990001');
    assert.ok(url.includes('phone=5541999990001'), 'phone deve ser apenas dígitos');
  });

  it('inclui parâmetro text com "Olá" encodado por padrão', () => {
    const url = buildWhatsAppWebUrl('whatsapp:+5541999990001');
    assert.ok(url.includes('text=Ol%C3%A1'), 'texto padrão deve ser "Olá" encodado');
  });

  it('aceita texto customizado', () => {
    const url = buildWhatsAppWebUrl('whatsapp:+5541999990001', 'Boa tarde!');
    assert.ok(url.includes('text=Boa%20tarde!'), 'texto customizado deve ser encodado');
  });

  it('funciona com número já no formato limpo', () => {
    const url = buildWhatsAppWebUrl('5511888880003');
    assert.equal(url, 'https://web.whatsapp.com/send?phone=5511888880003&text=Ol%C3%A1');
  });

  it('funciona com número com formatação (parênteses e traços)', () => {
    const url = buildWhatsAppWebUrl('+55 (41) 99999-0001');
    assert.equal(url, 'https://web.whatsapp.com/send?phone=5541999990001&text=Ol%C3%A1');
  });

  it('funciona com número internacional sem prefixo whatsapp', () => {
    const url = buildWhatsAppWebUrl('+5521999990004');
    assert.equal(url, 'https://web.whatsapp.com/send?phone=5521999990004&text=Ol%C3%A1');
  });

  it('URL resultante não contém "whatsapp:" nem "+"', () => {
    const url = buildWhatsAppWebUrl('whatsapp:+5541999990001');
    assert.ok(!url.includes('whatsapp:'), 'não deve conter "whatsapp:"');
    const phoneParam = url.split('phone=')[1].split('&')[0];
    assert.ok(!phoneParam.includes('+'), 'phone param não deve conter "+"');
  });
});
