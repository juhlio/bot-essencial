const logger = require('../utils/logger');

// ─── Configuração ─────────────────────────────────────────────────────────────
const API_KEY       = process.env.RD_STATION_API_KEY;
const ENABLED       = process.env.RD_STATION_ENABLED === 'true';
const CONVERSION_ID = process.env.RD_STATION_CONVERSION_ID || 'whatsapp-bot-essencial';
const TIMEOUT_MS    = 10_000;
const ENDPOINT      = `https://api.rd.services/platform/conversions?api_key=${API_KEY}`;

// ─── Labels de campos mapeados ────────────────────────────────────────────────
const KVA_LABELS = {
  1: 'Até 50 kVA',
  2: 'De 50 a 100 kVA',
  3: 'De 100 a 200 kVA',
  4: 'De 200 a 300 kVA',
  5: 'Acima de 300 kVA',
  6: 'Não sei / Preciso de dimensionamento',
};

const CONTRACT_LABELS = {
  1: 'Stand-by',
  2: 'Prime/Contínua',
  3: 'Longo Prazo',
  4: 'Outro/Sob Demanda',
};

// ─── Estado interno ───────────────────────────────────────────────────────────
let _disabledLogged = false;

// ─── _isEnabled ───────────────────────────────────────────────────────────────
function _isEnabled() {
  if (ENABLED && API_KEY) return true;
  if (!_disabledLogged) {
    logger.info('RD Station: integração desabilitada');
    _disabledLogged = true;
  }
  return false;
}

// ─── buildRdPayload ───────────────────────────────────────────────────────────
// Monta o objeto `payload` interno do evento de conversão.
// Campos null/undefined são omitidos.
function buildRdPayload(session) {
  const q = session.qualificationData || {};

  const tags = ['whatsapp'];
  if (session.segment) tags.push(session.segment);
  tags.push(session.isIcp ? 'qualificado' : 'fora_do_icp');

  const payload = { conversion_identifier: CONVERSION_ID };

  if (session.email)       payload.email            = session.email;
  if (session.name)        payload.name             = session.name;
  if (session.phone) {
                           payload.personal_phone   = session.phone;
                           payload.mobile_phone     = session.phone;
  }
  if (session.companyName) payload.company_name     = session.companyName;
  if (session.document)    payload.cf_cpf_cnpj      = session.document;
  if (session.companyName) payload.cf_empresa_lead  = session.companyName;
  if (q.kvaRange)          payload.cf_potencia_kva  = KVA_LABELS[q.kvaRange]      || String(q.kvaRange);
  if (q.contractType)      payload.cf_tipo_contrato = CONTRACT_LABELS[q.contractType] || String(q.contractType);
  if (q.equipmentBrand)    payload.cf_marca_gerador  = q.equipmentBrand;
  if (q.equipmentModel)    payload.cf_modelo_gerador = q.equipmentModel;

  payload.tags = tags;

  return payload;
}

// ─── sendConversion ───────────────────────────────────────────────────────────
// Envia um evento de conversão ao RD Station.
// Nunca lança exceção — sempre retorna { success, status?, error?, reason? }.
async function sendConversion(session) {
  if (!module.exports._isEnabled()) return { success: false, reason: 'disabled' };

  const body = {
    event_type:   'CONVERSION',
    event_family: 'CDP',
    payload:      buildRdPayload(session),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    });

    clearTimeout(timer);

    const status = response.status;

    if (status >= 200 && status < 300) {
      logger.info(`RD Station: conversão enviada [${session.phoneNumber}]`);
      return { success: true, status };
    }

    logger.error(`RD Station: erro ao enviar [${session.phoneNumber}]: HTTP ${status}`);
    return { success: false, status };

  } catch (err) {
    clearTimeout(timer);
    const message = err.name === 'AbortError' ? 'timeout (10s)' : err.message;
    logger.error(`RD Station: erro ao enviar [${session.phoneNumber}]: ${message}`);
    return { success: false, error: message };
  }
}

module.exports = { sendConversion, buildRdPayload, _isEnabled };
