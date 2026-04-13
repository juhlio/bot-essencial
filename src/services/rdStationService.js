const https = require('https');
const logger = require('../utils/logger');

// ─── Configuração ─────────────────────────────────────────────────────────────
const BASE_URL    = process.env.RD_API_URL || 'https://api.rd.services';
const API_KEY     = process.env.RD_API_KEY;
const RD_ENABLED  = process.env.RD_ENABLED !== 'false';
const TIMEOUT_MS  = 10_000;
const MAX_RETRIES = 3;

// Status que NÃO devem ser retentados
const NO_RETRY_STATUSES = new Set([400, 401, 403, 404, 409, 422]);

// Códigos de erro de rede que permitem retry
const RETRY_NETWORK_ERRORS = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND']);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function backoffMs(attempt) {
  // 1s → 2s → 4s
  return 1000 * Math.pow(2, attempt);
}

function sanitizePayload(payload) {
  if (!payload) return payload;
  const safe = { ...payload };
  if (safe.custom_fields) {
    safe.custom_fields = { ...safe.custom_fields };
    if (safe.custom_fields.cpf_cnpj) safe.custom_fields.cpf_cnpj = '[REDACTED]';
  }
  return safe;
}

// ─── Requisição HTTP nativa ───────────────────────────────────────────────────
function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url      = new URL(path, BASE_URL);
    const bodyData = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port:     url.port || 443,
      path:     url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
      timeout: TIMEOUT_MS,
    };

    if (bodyData) {
      options.headers['Content-Length'] = Buffer.byteLength(bodyData);
    }

    const req = https.request(options, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(Object.assign(new Error('Request timed out'), { code: 'ETIMEDOUT' }));
    });

    req.on('error', reject);

    if (bodyData) req.write(bodyData);
    req.end();
  });
}

// ─── Retry com exponential backoff ───────────────────────────────────────────
async function requestWithRetry(method, path, body = null) {
  let lastError;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const t0 = Date.now();
    try {
      const res = await request(method, path, body);
      const ms  = Date.now() - t0;

      logger.info(`RDStation ${method} ${path} → ${res.status} (${ms}ms)`);

      if (res.status >= 200 && res.status < 300) {
        return res.body;
      }

      // Sem retry para erros de cliente conhecidos
      if (NO_RETRY_STATUSES.has(res.status)) {
        const err = new Error(`RDStation ${res.status}: ${JSON.stringify(res.body)}`);
        err.status    = res.status;
        err.response  = res.body;
        throw err;
      }

      // Retry em 429 e 5xx
      lastError = new Error(`RDStation ${res.status}: ${JSON.stringify(res.body)}`);
      lastError.status   = res.status;
      lastError.response = res.body;

      if (attempt < MAX_RETRIES - 1) {
        const wait = res.status === 429 && res.headers['retry-after']
          ? parseInt(res.headers['retry-after']) * 1000
          : backoffMs(attempt);
        logger.warn(`RDStation retry ${attempt + 1}/${MAX_RETRIES - 1} em ${wait}ms (status ${res.status})`);
        await sleep(wait);
      }

    } catch (err) {
      const ms = Date.now() - t0;

      // Erros de cliente sem retry (já lançados acima)
      if (err.status && NO_RETRY_STATUSES.has(err.status)) throw err;

      // Erros de rede — retry
      const isNetworkError = RETRY_NETWORK_ERRORS.has(err.code);
      lastError = err;

      logger.error(`RDStation ${method} ${path} erro (${ms}ms): ${err.message} [code=${err.code}]`);

      if (!isNetworkError && !err.code) throw err; // erro inesperado, não retry

      if (attempt < MAX_RETRIES - 1) {
        const wait = backoffMs(attempt);
        logger.warn(`RDStation retry ${attempt + 1}/${MAX_RETRIES - 1} em ${wait}ms (${err.code})`);
        await sleep(wait);
      }
    }
  }

  throw lastError;
}

// ─── Classe principal ─────────────────────────────────────────────────────────
class RDStationService {

  _isEnabled() {
    if (!RD_ENABLED) {
      logger.debug('RDStation: integração desabilitada (RD_ENABLED=false), skip.');
      return false;
    }
    if (!API_KEY) {
      logger.warn('RDStation: RD_API_KEY não configurada, skip.');
      return false;
    }
    return true;
  }

  // ── POST /platform/contacts ──────────────────────────────────────────────
  async createContact(payload) {
    if (!this._isEnabled()) return null;

    logger.debug(`RDStation createContact payload: ${JSON.stringify(sanitizePayload(payload))}`);

    try {
      const result = await requestWithRetry('POST', '/platform/contacts', payload);
      logger.info(`RDStation contato criado: id=${result?.id} email=${payload.email}`);
      return result;

    } catch (err) {
      // EMAIL_ALREADY_IN_USE (422) — tratar como caso esperado
      if (err.status === 422) {
        const code = err.response?.errors?.[0]?.error_type || '';
        if (code === 'EMAIL_ALREADY_IN_USE' || JSON.stringify(err.response).includes('EMAIL_ALREADY_IN_USE')) {
          logger.warn(`RDStation createContact: email já cadastrado (${payload.email}), retornando null`);
          return null;
        }
      }
      logger.error(`RDStation createContact falhou [${payload.email}]: ${err.message}`);
      throw err;
    }
  }

  // ── PUT /platform/contacts/{id} ──────────────────────────────────────────
  async updateContact(rdContactId, payload) {
    if (!this._isEnabled()) return null;
    if (!rdContactId) throw new Error('RDStation updateContact: rdContactId é obrigatório');

    logger.debug(`RDStation updateContact id=${rdContactId} payload: ${JSON.stringify(sanitizePayload(payload))}`);

    try {
      const result = await requestWithRetry('PUT', `/platform/contacts/${rdContactId}`, payload);
      logger.info(`RDStation contato atualizado: id=${rdContactId}`);
      return result;

    } catch (err) {
      logger.error(`RDStation updateContact falhou [id=${rdContactId}]: ${err.message}`);
      throw err;
    }
  }

  // ── GET /platform/contacts?email={email} ─────────────────────────────────
  async getContact(email) {
    if (!this._isEnabled()) return null;
    if (!email) throw new Error('RDStation getContact: email é obrigatório');

    const encoded = encodeURIComponent(email);
    logger.debug(`RDStation getContact email=${email}`);

    try {
      const result = await requestWithRetry('GET', `/platform/contacts?email=${encoded}`);
      const found  = result?.contacts?.[0] || result || null;
      logger.info(`RDStation getContact email=${email}: ${found ? `encontrado id=${found.id}` : 'não encontrado'}`);
      return found;

    } catch (err) {
      if (err.status === 404) {
        logger.info(`RDStation getContact: contato não encontrado (${email})`);
        return null;
      }
      logger.error(`RDStation getContact falhou [${email}]: ${err.message}`);
      throw err;
    }
  }

  // ── upsertContact: cria ou atualiza por email ─────────────────────────────
  async upsertContact(payload) {
    if (!this._isEnabled()) return null;

    const existing = await this.getContact(payload.email);

    if (existing?.id) {
      logger.info(`RDStation upsert: contato existente id=${existing.id}, atualizando`);
      return this.updateContact(existing.id, payload);
    }

    logger.info(`RDStation upsert: contato novo, criando (${payload.email})`);
    return this.createContact(payload);
  }
}

module.exports = new RDStationService();

// =============================================================================
// EXEMPLOS DE USO
// =============================================================================
//
// const rdStation = require('./rdStationService');
//
// // Criar contato
// await rdStation.createContact({
//   name:         'Julio Ramos',
//   email:        'julio@essencial.com',
//   mobile_phone: '(11) 99999-0001',
//   city:         'São Paulo',
//   state:        'SP',
//   tags:         ['whatsapp', 'venda', 'qualificado'],
//   custom_fields: {
//     cpf_cnpj:       '11222333000181',
//     empresa:        'Essencial Energia',
//     potencia_kva:   '3',
//     tipo_contrato:  'venda',
//     marca_gerador:  'Caterpillar',
//     modelo_gerador: 'C175 D5',
//   },
// });
//
// // Buscar contato por email
// const contact = await rdStation.getContact('julio@essencial.com');
// // → { id: 123456789, name: 'Julio Ramos', email: 'julio@essencial.com', ... }
//
// // Atualizar contato
// await rdStation.updateContact(123456789, { tags: ['whatsapp', 'venda', 'qualificado'] });
//
// // Upsert (cria se não existir, atualiza se existir)
// await rdStation.upsertContact({ email: 'julio@essencial.com', name: 'Julio Ramos' });
//
// Variáveis de ambiente necessárias (.env):
//   RD_API_KEY=sua_chave_aqui
//   RD_API_URL=https://api.rd.services   # opcional
//   RD_ENABLED=true                      # false desabilita todas as chamadas
