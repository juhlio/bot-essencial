const Redis = require('ioredis');
const logger = require('../utils/logger');

function newSession(phoneNumber) {
  return {
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
}

function buildPayload(session) {
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

class RedisSessionStore {
  constructor(redisUrl) {
    this.ttl = (parseInt(process.env.BOT_CLOSE_TIMEOUT_MIN) || 40) * 60;
    this.fallback = new Map();
    this.usingFallback = false;

    this.client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });

    this.client.on('error', (err) => {
      if (!this.usingFallback) {
        logger.error(`Redis connection error — ativando fallback em memória: ${err.message}`);
        this.usingFallback = true;
      }
    });

    this.client.on('connect', () => {
      if (this.usingFallback) {
        logger.info('Redis reconectado — voltando ao Redis');
        this.usingFallback = false;
      }
    });
  }

  async connect() {
    try {
      await this.client.connect();
      await this.client.ping();
      logger.info('Redis conectado com sucesso');
      this.usingFallback = false;
    } catch (err) {
      logger.error(`Falha ao conectar ao Redis — usando fallback em memória: ${err.message}`);
      this.usingFallback = true;
    }
  }

  // ─── Helpers internos ──────────────────────────────────────────────────────
  _key(phoneNumber) {
    return `session:${phoneNumber}`;
  }

  async _redisGet(phoneNumber) {
    const raw = await this.client.get(this._key(phoneNumber));
    return raw ? JSON.parse(raw) : null;
  }

  async _redisSet(session) {
    await this.client.set(
      this._key(session.phoneNumber),
      JSON.stringify(session),
      'EX',
      this.ttl
    );
  }

  async _redisDel(phoneNumber) {
    await this.client.del(this._key(phoneNumber));
  }

  // ─── Interface pública ─────────────────────────────────────────────────────
  async get(phoneNumber) {
    if (this.usingFallback) {
      if (this.fallback.has(phoneNumber)) {
        const session = this.fallback.get(phoneNumber);
        session.lastActivity = Date.now();
        return session;
      }
      return this.create(phoneNumber);
    }

    try {
      const session = await this._redisGet(phoneNumber);
      if (session) {
        session.lastActivity = Date.now();
        await this._redisSet(session);
        return session;
      }
      return this.create(phoneNumber);
    } catch (err) {
      logger.error(`Redis get error: ${err.message}`);
      this.usingFallback = true;
      return this.get(phoneNumber);
    }
  }

  async create(phoneNumber) {
    const session = newSession(phoneNumber);
    logger.info(`Sessão criada: ${phoneNumber}`);

    if (this.usingFallback) {
      this.fallback.set(phoneNumber, session);
      return session;
    }

    try {
      await this._redisSet(session);
    } catch (err) {
      logger.error(`Redis create error: ${err.message}`);
      this.usingFallback = true;
      this.fallback.set(phoneNumber, session);
    }

    return session;
  }

  async update(phoneNumber, data) {
    if (this.usingFallback) {
      const session = this.fallback.get(phoneNumber);
      if (!session) {
        logger.warn(`Tentativa de atualizar sessão inexistente: ${phoneNumber}`);
        return null;
      }
      Object.assign(session, data, { lastActivity: Date.now() });
      return session;
    }

    try {
      const session = await this._redisGet(phoneNumber);
      if (!session) {
        logger.warn(`Tentativa de atualizar sessão inexistente: ${phoneNumber}`);
        return null;
      }
      Object.assign(session, data, { lastActivity: Date.now() });
      await this._redisSet(session);
      return session;
    } catch (err) {
      logger.error(`Redis update error: ${err.message}`);
      this.usingFallback = true;
      return this.update(phoneNumber, data);
    }
  }

  async reset(phoneNumber) {
    logger.info(`Sessão resetada: ${phoneNumber}`);

    if (this.usingFallback) {
      this.fallback.delete(phoneNumber);
      return this.create(phoneNumber);
    }

    try {
      await this._redisDel(phoneNumber);
    } catch (err) {
      logger.error(`Redis reset error: ${err.message}`);
      this.usingFallback = true;
    }

    return this.create(phoneNumber);
  }

  async has(phoneNumber) {
    if (this.usingFallback) return this.fallback.has(phoneNumber);
    try {
      const exists = await this.client.exists(this._key(phoneNumber));
      return exists === 1;
    } catch (err) {
      logger.error(`Redis has error: ${err.message}`);
      return this.fallback.has(phoneNumber);
    }
  }

  async cleanExpired() {
    // Redis expira automaticamente via TTL; limpa apenas o fallback em memória
    if (!this.usingFallback) return 0;

    const timeoutMs = this.ttl * 1000;
    const now = Date.now();
    let removed = 0;

    for (const [phoneNumber, session] of this.fallback) {
      if (now - session.lastActivity > timeoutMs || session.completed) {
        this.fallback.delete(phoneNumber);
        removed++;
        logger.info(`Sessão expirada removida (fallback): ${phoneNumber}`);
      }
    }

    return removed;
  }

  async count() {
    if (this.usingFallback) return this.fallback.size;

    try {
      const keys = await this.client.keys('session:*');
      return keys.length;
    } catch (err) {
      logger.error(`Redis count error: ${err.message}`);
      return this.fallback.size;
    }
  }

  async toPayload(phoneNumber) {
    if (this.usingFallback) {
      const session = this.fallback.get(phoneNumber);
      return session ? buildPayload(session) : null;
    }

    try {
      const session = await this._redisGet(phoneNumber);
      return session ? buildPayload(session) : null;
    } catch (err) {
      logger.error(`Redis toPayload error: ${err.message}`);
      return null;
    }
  }
}

module.exports = { RedisSessionStore };
