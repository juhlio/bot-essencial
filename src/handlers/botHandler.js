const { sessionStore } = require('../services/sessionStore');
const { lookupCNPJ } = require('../services/cnpjService');
const { validateDocument, isValidEmail, isValidPhone, formatPhone, isValidOption, validateLocation } = require('../validators/validators');
const { getMessage, buildInterestLine } = require('../utils/messages');
const { saveLead, saveSession } = require('../database/leadRepository');
const logger = require('../utils/logger');

const RESET_KEYWORDS = ['reiniciar', 'recomeçar', 'voltar', 'menu'];

function logPayload(phoneNumber) {
  const payload = sessionStore.toPayload(phoneNumber);
  logger.info(`Lead finalizado [${phoneNumber}]: ${JSON.stringify(payload)}`);
}

function persistLead(session) {
  logPayload(session.phoneNumber);
  saveLead(session)
    .then((lead) => {
      if (lead) {
        logger.info(`Lead persistido no banco [id=${lead.id}]`);
        return saveSession(session.phoneNumber, session, lead.id);
      }
      return saveSession(session.phoneNumber, session, null);
    })
    .catch((err) => {
      logger.error(`persistLead error: ${err.message}`);
    });
}

async function checkMaxErrors(session, errorMessage) {
  session.stepErrorCount += 1;
  session.errorCount += 1;

  if (session.stepErrorCount >= 3) {
    session.completed = true;
    return [errorMessage, await getMessage('maxErrors')];
  }

  return [errorMessage];
}

function goToStep(session, step) {
  session.step = step;
  session.stepErrorCount = 0;
}

// Monta a mensagem de encerramento a partir dos templates closing_header e closing_footer
// O resumo dinâmico intermediário (nome, empresa, email, telefone, interesse) fica em código.
async function buildClosing(session) {
  const team = session.segment === 'manutencao' ? 'técnica' : 'comercial';
  const header = await getMessage('closing_header');
  const footer = await getMessage('closing_footer', { team });
  const companyLine = session.companyName ? `\n✅ *Empresa:* ${session.companyName}` : '';
  const resumo =
    `✅ *Nome:* ${session.name}` +
    companyLine +
    `\n✅ *E-mail:* ${session.email}` +
    `\n✅ *Telefone:* ${session.phone}` +
    `\n${buildInterestLine(session)}`;
  return header + '\n' + resumo + '\n\n' + footer;
}

// ── Step handlers ─────────────────────────────────────────────────────────────

const stepHandlers = {
  async greeting(session) {
    goToStep(session, 'awaiting_name');
    return [await getMessage('greeting')];
  },

  async awaiting_name(session, body) {
    const name = body.trim();
    if (name.length < 3) {
      return checkMaxErrors(session, await getMessage('invalidName'));
    }
    session.name = name;
    goToStep(session, 'awaiting_document');
    return [await getMessage('askDocument', { name })];
  },

  async awaiting_document(session, body) {
    const { valid, type, cleaned } = validateDocument(body);
    if (!valid) {
      return checkMaxErrors(session, await getMessage('invalidDocument'));
    }

    session.document = cleaned;
    session.documentType = type;

    if (type === 'cnpj') {
      const data = await lookupCNPJ(cleaned);
      if (data && data.razaoSocial) {
        session.companyName = data.razaoSocial;
        goToStep(session, 'awaiting_email');
        return [await getMessage('documentFoundCNPJ', { company: data.razaoSocial })];
      }
    }

    goToStep(session, 'awaiting_email');
    return [await getMessage('documentOk')];
  },

  async awaiting_email(session, body) {
    const email = body.trim().toLowerCase();
    if (!isValidEmail(email)) {
      return checkMaxErrors(session, await getMessage('invalidEmail'));
    }
    session.email = email;
    goToStep(session, 'awaiting_phone');
    return [await getMessage('askPhone')];
  },

  async awaiting_phone(session, body) {
    if (!isValidPhone(body)) {
      return checkMaxErrors(session, await getMessage('invalidPhone'));
    }
    session.phone = formatPhone(body);
    goToStep(session, 'awaiting_segment');
    return [await getMessage('askSegment', { name: session.name })];
  },

  async awaiting_segment(session, body) {
    if (!isValidOption(body, 1, 3)) {
      return checkMaxErrors(session, await getMessage('invalidOption'));
    }
    const option = parseInt(body, 10);
    const segmentMap  = { 1: 'venda',        2: 'locacao',            3: 'manutencao'    };
    const stepMap     = { 1: 'awaiting_kva',  2: 'awaiting_contract',  3: 'awaiting_brand' };
    const msgKeyMap   = { 1: 'askKva',        2: 'askContract',        3: 'askBrand'       };

    session.segment = segmentMap[option];
    goToStep(session, stepMap[option]);
    return [await getMessage(msgKeyMap[option])];
  },

  async awaiting_location(session, body) {
    const { isValid, message } = validateLocation(body);
    if (!isValid) {
      return checkMaxErrors(session, message);
    }

    session.qualificationData.location = body.trim();

    const nextStepMap = { venda: 'awaiting_kva', locacao: 'awaiting_contract', manutencao: 'awaiting_brand' };
    const msgKeyMap  = { venda: 'askKva',        locacao: 'askContract',        manutencao: 'askBrand'       };

    goToStep(session, nextStepMap[session.segment]);
    return [await getMessage(msgKeyMap[session.segment])];
  },

  async awaiting_kva(session, body) {
    if (!isValidOption(body, 1, 6)) {
      return checkMaxErrors(session, await getMessage('invalidOption'));
    }
    const option = parseInt(body, 10);
    session.qualificationData.kvaRange = option;

    if (option === 1) {
      session.isIcp = false;
      goToStep(session, 'awaiting_newsletter_optin');
      return [await getMessage('outOfIcp', { name: session.name })];
    }

    session.completed = true;
    persistLead(session);
    return [await buildClosing(session)];
  },

  async awaiting_newsletter_optin(session, body) {
    if (!isValidOption(body, 1, 2)) {
      return checkMaxErrors(session, await getMessage('invalidOption'));
    }
    const option = parseInt(body, 10);
    session.optInNewsletter = option === 1;
    session.completed = true;
    persistLead(session);
    return [await getMessage(option === 1 ? 'outOfIcpOptIn' : 'outOfIcpOptOut')];
  },

  async awaiting_contract(session, body) {
    if (!isValidOption(body, 1, 4)) {
      return checkMaxErrors(session, await getMessage('invalidOption'));
    }
    session.qualificationData.contractType = parseInt(body, 10);
    session.completed = true;
    persistLead(session);
    return [await buildClosing(session)];
  },

  async awaiting_brand(session, body) {
    const brand = body.trim();
    if (brand.length < 2) {
      return checkMaxErrors(session, await getMessage('invalidOption'));
    }
    session.qualificationData.equipmentBrand = brand;
    goToStep(session, 'awaiting_model');
    return [await getMessage('askModel')];
  },

  async awaiting_model(session, body) {
    session.qualificationData.equipmentModel = body.trim();
    session.completed = true;
    persistLead(session);
    return [await buildClosing(session)];
  },
};

// ── handleMessage ─────────────────────────────────────────────────────────────

async function handleMessage(from, body, profileName) {
  const input = (body || '').trim();
  const normalized = input.toLowerCase();

  // Comando de reset
  if (RESET_KEYWORDS.includes(normalized)) {
    const fresh = await sessionStore.reset(from);
    goToStep(fresh, 'awaiting_name');
    await sessionStore.update(from, fresh);
    return [await getMessage('restart'), await getMessage('greeting')];
  }

  const session = await sessionStore.get(from);

  // Sessão já concluída → reinicia
  if (session.completed) {
    const fresh = await sessionStore.reset(from);
    goToStep(fresh, 'awaiting_name');
    await sessionStore.update(from, fresh);
    return [await getMessage('greeting')];
  }

  const handler = stepHandlers[session.step];

  if (!handler) {
    logger.warn(`Step desconhecido [${from}]: ${session.step}`);
    const fresh = await sessionStore.reset(from);
    goToStep(fresh, 'awaiting_name');
    await sessionStore.update(from, fresh);
    return [await getMessage('greeting')];
  }

  const result = await handler(session, input, profileName);

  // Persiste alterações feitas diretamente no objeto da sessão
  await sessionStore.update(from, session);

  return result;
}

module.exports = { handleMessage };
