const logger = require('../utils/logger');

// ─── Configuração ─────────────────────────────────────────────────────────────
const BASE_URL      = process.env.EVOLUTION_API_URL      || 'http://evolution:8080';
const API_KEY       = process.env.EVOLUTION_API_KEY      || '';
const INSTANCE      = process.env.EVOLUTION_INSTANCE_NAME || 'essencial-bot';
const TIMEOUT_MS    = 10_000;

// ─── _request ─────────────────────────────────────────────────────────────────
// Executa uma requisição HTTP para a Evolution API.
// Lança Error em caso de falha de rede ou status HTTP >= 400.
async function _request(method, path, body) {
  const url = `${BASE_URL}${path}`;

  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': API_KEY,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return response.json();
}

// ─── sendMessage ──────────────────────────────────────────────────────────────
// Envia uma mensagem de texto para um número via Evolution API.
// Retorna { success, messageId? } — nunca lança exceção.
async function sendMessage(phoneNumber, message) {
  if (!API_KEY) {
    logger.warn('Evolution: EVOLUTION_API_KEY não configurada, envio ignorado');
    return { success: false, reason: 'missing_api_key' };
  }

  const number = phoneNumber.includes('@') ? phoneNumber : phoneNumber.replace(/\D/g, '');

  try {
    const data = await _request('POST', `/message/sendText/${INSTANCE}`, {
      number,
      textMessage: { text: message },
    });

    const messageId = data?.key?.id;
    logger.info(`Evolution: mensagem enviada para ${number} [id=${messageId}]`);
    return { success: true, messageId };

  } catch (err) {
    const reason = err.name === 'TimeoutError' ? `timeout (${TIMEOUT_MS}ms)` : err.message;
    logger.error(`Evolution: erro ao enviar mensagem para ${number}: ${reason}`);
    return { success: false, error: reason };
  }
}

// ─── getInstance ──────────────────────────────────────────────────────────────
// Retorna os dados da instância configurada.
// Retorna { success, instance? } — nunca lança exceção.
async function getInstance() {
  if (!API_KEY) {
    logger.warn('Evolution: EVOLUTION_API_KEY não configurada');
    return { success: false, reason: 'missing_api_key' };
  }

  try {
    const data = await _request('GET', `/instance/fetchInstances?instanceName=${INSTANCE}`);

    logger.info(`Evolution: instância obtida [${INSTANCE}]`);
    return { success: true, instance: data };

  } catch (err) {
    const reason = err.name === 'TimeoutError' ? `timeout (${TIMEOUT_MS}ms)` : err.message;
    logger.error(`Evolution: erro ao obter instância [${INSTANCE}]: ${reason}`);
    return { success: false, error: reason };
  }
}

// ─── health ───────────────────────────────────────────────────────────────────
// Verifica se a Evolution API está respondendo.
// Retorna { success, status? } — nunca lança exceção.
async function health() {
  try {
    await _request('GET', '/');

    logger.info('Evolution: API saudável');
    return { success: true };

  } catch (err) {
    const reason = err.name === 'TimeoutError' ? `timeout (${TIMEOUT_MS}ms)` : err.message;
    logger.error(`Evolution: health check falhou: ${reason}`);
    return { success: false, error: reason };
  }
}

module.exports = { sendMessage, getInstance, health };
