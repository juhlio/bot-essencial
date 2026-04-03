const logger = require('../utils/logger');

async function lookupCNPJ(cnpj) {
  const baseUrl = process.env.CNPJ_API_URL;

  if (!baseUrl) {
    logger.warn('CNPJ_API_URL não configurada, consulta ignorada');
    return null;
  }

  const url = `${baseUrl}/${cnpj}`;
  logger.info(`Consultando CNPJ: ${cnpj}`);

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      logger.warn(`CNPJ API retornou status ${response.status} para ${cnpj}`);
      return null;
    }

    const data = await response.json();

    return {
      razaoSocial: data.razao_social || null,
      nomeFantasia: data.nome_fantasia || null,
      situacao: data.descricao_situacao_cadastral || null,
    };
  } catch (err) {
    if (err.name === 'TimeoutError') {
      logger.error(`Timeout ao consultar CNPJ ${cnpj}`);
    } else {
      logger.error(`Erro ao consultar CNPJ ${cnpj}: ${err.message}`);
    }
    return null;
  }
}

module.exports = { lookupCNPJ };
