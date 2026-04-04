const { sessionStore } = require('../services/sessionStore');
const { lookupCNPJ } = require('../services/cnpjService');
const { validateDocument, isValidEmail, isValidPhone, formatPhone, isValidOption } = require('../validators/validators');
const { messages } = require('../utils/messages');
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

function checkMaxErrors(session, errorMessage) {
  session.stepErrorCount += 1;
  session.errorCount += 1;

  if (session.stepErrorCount >= 3) {
    session.completed = true;
    return [errorMessage, messages.maxErrors];
  }

  return [errorMessage];
}

function goToStep(session, step) {
  session.step = step;
  session.stepErrorCount = 0;
}

const stepHandlers = {
  greeting(session) {
    goToStep(session, 'awaiting_name');
    return [messages.greeting];
  },

  awaiting_name(session, body) {
    const name = body.trim();
    if (name.length < 3) {
      return checkMaxErrors(session, messages.invalidName);
    }
    session.name = name;
    goToStep(session, 'awaiting_document');
    return [messages.askDocument(name)];
  },

  async awaiting_document(session, body) {
    const { valid, type, cleaned } = validateDocument(body);
    if (!valid) {
      return checkMaxErrors(session, messages.invalidDocument);
    }

    session.document = cleaned;
    session.documentType = type;

    if (type === 'cnpj') {
      const data = await lookupCNPJ(cleaned);
      if (data && data.razaoSocial) {
        session.companyName = data.razaoSocial;
        goToStep(session, 'awaiting_email');
        return [messages.documentFoundCNPJ(data.razaoSocial)];
      }
    }

    goToStep(session, 'awaiting_email');
    return [messages.documentOk];
  },

  awaiting_email(session, body) {
    const email = body.trim().toLowerCase();
    if (!isValidEmail(email)) {
      return checkMaxErrors(session, messages.invalidEmail);
    }
    session.email = email;
    goToStep(session, 'awaiting_phone');
    return [messages.askPhone];
  },

  awaiting_phone(session, body) {
    if (!isValidPhone(body)) {
      return checkMaxErrors(session, messages.invalidPhone);
    }
    session.phone = formatPhone(body);
    goToStep(session, 'awaiting_segment');
    return [messages.askSegment(session.name)];
  },

  awaiting_segment(session, body) {
    if (!isValidOption(body, 1, 3)) {
      return checkMaxErrors(session, messages.invalidOption);
    }
    const option = parseInt(body, 10);
    const segmentMap = { 1: 'venda', 2: 'locacao', 3: 'manutencao' };
    const stepMap = { 1: 'awaiting_kva', 2: 'awaiting_contract', 3: 'awaiting_brand' };
    const msgMap = { 1: messages.askKva, 2: messages.askContract, 3: messages.askBrand };

    session.segment = segmentMap[option];
    goToStep(session, stepMap[option]);
    return [msgMap[option]];
  },

  awaiting_kva(session, body) {
    if (!isValidOption(body, 1, 6)) {
      return checkMaxErrors(session, messages.invalidOption);
    }
    const option = parseInt(body, 10);
    session.qualificationData.kvaRange = option;

    if (option === 1) {
      session.isIcp = false;
      goToStep(session, 'awaiting_newsletter_optin');
      return [messages.outOfIcp(session.name)];
    }

    session.completed = true;
    persistLead(session);
    return [messages.closing(session)];
  },

  awaiting_newsletter_optin(session, body) {
    if (!isValidOption(body, 1, 2)) {
      return checkMaxErrors(session, messages.invalidOption);
    }
    const option = parseInt(body, 10);
    session.optInNewsletter = option === 1;
    session.completed = true;
    persistLead(session);
    return [option === 1 ? messages.outOfIcpOptIn : messages.outOfIcpOptOut];
  },

  awaiting_contract(session, body) {
    if (!isValidOption(body, 1, 4)) {
      return checkMaxErrors(session, messages.invalidOption);
    }
    session.qualificationData.contractType = parseInt(body, 10);
    session.completed = true;
    persistLead(session);
    return [messages.closing(session)];
  },

  awaiting_brand(session, body) {
    const brand = body.trim();
    if (brand.length < 2) {
      return checkMaxErrors(session, messages.invalidOption);
    }
    session.qualificationData.equipmentBrand = brand;
    goToStep(session, 'awaiting_model');
    return [messages.askModel];
  },

  awaiting_model(session, body) {
    session.qualificationData.equipmentModel = body.trim();
    session.completed = true;
    persistLead(session);
    return [messages.closing(session)];
  },
};

async function handleMessage(from, body, profileName) {
  const input = (body || '').trim();
  const normalized = input.toLowerCase();

  // Comando de reset
  if (RESET_KEYWORDS.includes(normalized)) {
    sessionStore.reset(from);
    return [messages.restart, messages.greeting];
  }

  const session = sessionStore.get(from);

  // Sessão já concluída → reinicia
  if (session.completed) {
    sessionStore.reset(from);
    const fresh = sessionStore.get(from);
    goToStep(fresh, 'awaiting_name');
    return [messages.greeting];
  }

  const handler = stepHandlers[session.step];

  if (!handler) {
    logger.warn(`Step desconhecido [${from}]: ${session.step}`);
    sessionStore.reset(from);
    return [messages.greeting];
  }

  const result = await handler(session, input, profileName);

  // Persiste alterações feitas diretamente no objeto da sessão
  sessionStore.update(from, session);

  return result;
}

module.exports = { handleMessage };
