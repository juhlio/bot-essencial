const logger = require('../utils/logger');
const { RedisSessionStore } = require('./redisSessionStore');

// ─── Memory implementation ───────────────────────────────────────────────────
class SessionStore {
  constructor() {
    this.sessions = new Map();
  }

  get(phoneNumber) {
    if (this.sessions.has(phoneNumber)) {
      const session = this.sessions.get(phoneNumber);
      session.lastActivity = Date.now();
      return session;
    }
    return this.create(phoneNumber);
  }

  create(phoneNumber) {
    const session = {
      phoneNumber,
      step: 'greeting',
      name: null,
      document: null,
      documentType: null,
      companyName: null,
      email: null,
      phone: null,
      segment: null,
      qualificationData: {
        kvaRange: null,
        contractType: null,
        equipmentBrand: null,
        equipmentModel: null,
      },
      isIcp: true,
      optInNewsletter: null,
      errorCount: 0,
      stepErrorCount: 0,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      completed: false,
    };
    this.sessions.set(phoneNumber, session);
    logger.info(`Sessão criada: ${phoneNumber}`);
    return session;
  }

  update(phoneNumber, data) {
    const session = this.sessions.get(phoneNumber);
    if (!session) {
      logger.warn(`Tentativa de atualizar sessão inexistente: ${phoneNumber}`);
      return null;
    }
    Object.assign(session, data, { lastActivity: Date.now() });
    return session;
  }

  reset(phoneNumber) {
    this.sessions.delete(phoneNumber);
    logger.info(`Sessão resetada: ${phoneNumber}`);
    return this.create(phoneNumber);
  }

  has(phoneNumber) {
    return this.sessions.has(phoneNumber);
  }

  list() {
    return Array.from(this.sessions.values());
  }

  cleanExpired() {
    const timeoutMs = (parseInt(process.env.BOT_CLOSE_TIMEOUT_MIN) || 40) * 60 * 1000;
    const now = Date.now();
    let removed = 0;

    for (const [phoneNumber, session] of this.sessions) {
      const expired = now - session.lastActivity > timeoutMs;
      if (expired || session.completed) {
        this.sessions.delete(phoneNumber);
        removed++;
        logger.info(`Sessão expirada removida: ${phoneNumber}`);
      }
    }

    return removed;
  }

  count() {
    return this.sessions.size;
  }

  toPayload(phoneNumber) {
    const session = this.sessions.get(phoneNumber);
    if (!session) return null;

    const tags = ['whatsapp'];
    if (session.segment) tags.push(session.segment);
    tags.push(session.isIcp ? 'qualificado' : 'fora_do_icp');

    return {
      source: 'whatsapp_bot',
      timestamp: new Date().toISOString(),
      lead: {
        name: session.name,
        document_type: session.documentType,
        document: session.document,
        company_name: session.companyName,
        email: session.email,
        phone: session.phone,
      },
      qualification: {
        segment: session.segment,
        kva_range: session.qualificationData.kvaRange,
        contract_type: session.qualificationData.contractType,
        equipment_brand: session.qualificationData.equipmentBrand,
        equipment_model: session.qualificationData.equipmentModel,
        is_icp: session.isIcp,
      },
      tags,
    };
  }
}

// ─── Export: Redis if REDIS_URL is set, otherwise in-memory ─────────────────
let sessionStore;

if (process.env.REDIS_URL) {
  logger.info(`Usando Redis como session store: ${process.env.REDIS_URL}`);
  const redisStore = new RedisSessionStore(process.env.REDIS_URL);
  redisStore.connect();
  sessionStore = redisStore;
} else {
  logger.info('Usando session store em memória');
  sessionStore = new SessionStore();
}

module.exports = { sessionStore };
