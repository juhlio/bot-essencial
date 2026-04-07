const logger = require('../utils/logger');

function getPool() {
  const db = require('../services/database');
  return db.getPool();
}

function buildTags(session) {
  const tags = ['whatsapp'];
  if (session.segment) tags.push(session.segment);
  tags.push(session.isIcp ? 'qualificado' : 'fora_do_icp');
  return tags;
}

// ─── saveLead ────────────────────────────────────────────────────────────────
async function saveLead(session) {
  const pool = getPool();
  if (!pool) {
    logger.warn('saveLead: banco indisponível, operação ignorada');
    return null;
  }

  const tags = buildTags(session);
  const q = session.qualificationData || {};

  const text = `
    INSERT INTO leads (
      phone_number, name, document_type, document, company_name,
      email, phone, segment, kva_range, contract_type,
      equipment_brand, equipment_model, location, is_icp, opt_in_newsletter, tags
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16
    )
    RETURNING *
  `;

  const params = [
    session.phoneNumber,
    session.name,
    session.documentType,
    session.document,
    session.companyName || null,
    session.email,
    session.phone,
    session.segment,
    q.kvaRange || null,
    q.contractType || null,
    q.equipmentBrand || null,
    q.equipmentModel || null,
    q.location || null,
    session.isIcp,
    session.optInNewsletter !== undefined ? session.optInNewsletter : null,
    tags,
  ];

  try {
    const result = await pool.query(text, params);
    const lead = result.rows[0];
    logger.info(`Lead salvo: id=${lead.id} phone=${session.phoneNumber}`);
    return lead;
  } catch (err) {
    logger.error(`saveLead error: ${err.message}`);
    return null;
  }
}

// ─── saveSession ─────────────────────────────────────────────────────────────
async function saveSession(phoneNumber, session, leadId = null) {
  const pool = getPool();
  if (!pool) {
    logger.warn('saveSession: banco indisponível, operação ignorada');
    return null;
  }

  const startedAt = new Date(session.createdAt);
  const finishedAt = new Date();

  const text = `
    INSERT INTO sessions (
      phone_number, lead_id, step, completed, error_count,
      session_data, started_at, finished_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `;

  const params = [
    phoneNumber,
    leadId || null,
    session.step,
    session.completed,
    session.errorCount || 0,
    JSON.stringify(session),
    startedAt,
    finishedAt,
  ];

  try {
    const result = await pool.query(text, params);
    const row = result.rows[0];
    logger.info(`Sessão salva: id=${row.id} phone=${phoneNumber} duration=${row.duration_seconds}s`);
    return row;
  } catch (err) {
    logger.error(`saveSession error: ${err.message}`);
    return null;
  }
}

// ─── findLeadByPhone ─────────────────────────────────────────────────────────
async function findLeadByPhone(phoneNumber) {
  const pool = getPool();
  if (!pool) {
    logger.warn('findLeadByPhone: banco indisponível');
    return null;
  }

  try {
    const result = await pool.query(
      'SELECT * FROM leads WHERE phone_number = $1 ORDER BY created_at DESC LIMIT 1',
      [phoneNumber]
    );
    return result.rows[0] || null;
  } catch (err) {
    logger.error(`findLeadByPhone error: ${err.message}`);
    return null;
  }
}

// ─── findLeadByDocument ──────────────────────────────────────────────────────
async function findLeadByDocument(document) {
  const pool = getPool();
  if (!pool) {
    logger.warn('findLeadByDocument: banco indisponível');
    return null;
  }

  try {
    const result = await pool.query(
      'SELECT * FROM leads WHERE document = $1 ORDER BY created_at DESC LIMIT 1',
      [document]
    );
    return result.rows[0] || null;
  } catch (err) {
    logger.error(`findLeadByDocument error: ${err.message}`);
    return null;
  }
}

// ─── listLeads ───────────────────────────────────────────────────────────────
async function listLeads(filters = {}) {
  const pool = getPool();
  if (!pool) {
    logger.warn('listLeads: banco indisponível');
    return [];
  }

  const { segment, is_icp, date_from, date_to, limit = 50, offset = 0 } = filters;
  const conditions = [];
  const params = [];

  if (segment) {
    params.push(segment);
    conditions.push(`segment = $${params.length}`);
  }
  if (is_icp !== undefined) {
    params.push(is_icp);
    conditions.push(`is_icp = $${params.length}`);
  }
  if (date_from) {
    params.push(date_from);
    conditions.push(`created_at >= $${params.length}`);
  }
  if (date_to) {
    params.push(date_to);
    conditions.push(`created_at <= $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const text = `
    SELECT * FROM leads
    ${where}
    ORDER BY created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `;

  try {
    const result = await pool.query(text, params);
    return result.rows;
  } catch (err) {
    logger.error(`listLeads error: ${err.message}`);
    return [];
  }
}

// ─── countLeads ──────────────────────────────────────────────────────────────
async function countLeads(filters = {}) {
  const pool = getPool();
  if (!pool) {
    logger.warn('countLeads: banco indisponível');
    return null;
  }

  const { segment, is_icp, date_from, date_to } = filters;
  const conditions = [];
  const params = [];

  if (segment) {
    params.push(segment);
    conditions.push(`segment = $${params.length}`);
  }
  if (is_icp !== undefined) {
    params.push(is_icp);
    conditions.push(`is_icp = $${params.length}`);
  }
  if (date_from) {
    params.push(date_from);
    conditions.push(`created_at >= $${params.length}`);
  }
  if (date_to) {
    params.push(date_to);
    conditions.push(`created_at <= $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const text = `SELECT COUNT(*)::INTEGER AS total FROM leads ${where}`;

  try {
    const result = await pool.query(text, params);
    return result.rows[0].total;
  } catch (err) {
    logger.error(`countLeads error: ${err.message}`);
    return null;
  }
}

// ─── exportLeads ─────────────────────────────────────────────────────────────
async function exportLeads(filters = {}) {
  const pool = getPool();
  if (!pool) {
    logger.warn('exportLeads: banco indisponível');
    return [];
  }

  const { segment, is_icp, date_from, date_to } = filters;
  const conditions = [];
  const params = [];

  if (segment) {
    params.push(segment);
    conditions.push(`segment = $${params.length}`);
  }
  if (is_icp !== undefined) {
    params.push(is_icp);
    conditions.push(`is_icp = $${params.length}`);
  }
  if (date_from) {
    params.push(date_from);
    conditions.push(`created_at >= $${params.length}`);
  }
  if (date_to) {
    params.push(date_to);
    conditions.push(`created_at <= $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const text = `SELECT * FROM leads ${where} ORDER BY created_at DESC`;

  try {
    const result = await pool.query(text, params);
    return result.rows;
  } catch (err) {
    logger.error(`exportLeads error: ${err.message}`);
    return [];
  }
}

// ─── findLeadById ─────────────────────────────────────────────────────────────
async function findLeadById(id) {
  const pool = getPool();
  if (!pool) {
    logger.warn('findLeadById: banco indisponível');
    return null;
  }

  try {
    const result = await pool.query('SELECT * FROM leads WHERE id = $1', [id]);
    return result.rows[0] || null;
  } catch (err) {
    logger.error(`findLeadById error: ${err.message}`);
    return null;
  }
}

module.exports = {
  saveLead,
  saveSession,
  findLeadByPhone,
  findLeadByDocument,
  findLeadById,
  listLeads,
  countLeads,
  exportLeads,
};
