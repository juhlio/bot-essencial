const rdService = require('../services/rdStationService');
const logger    = require('../utils/logger');

function getPool() {
  return require('../services/database').getPool();
}

// ─── Monta payload para a RD Station ─────────────────────────────────────────
function buildPayload(session) {
  const [city = null, state = null] = session.location
    ? session.location.split(',').map(s => s.trim())
    : [];

  const tags = ['whatsapp'];
  if (session.segment)   tags.push(session.segment);
  tags.push(session.isIcp ? 'qualificado' : 'fora_icp');

  const q = session.qualificationData || {};

  return {
    name:         session.name,
    email:        session.email,
    mobile_phone: session.phone  || null,
    city,
    state,
    tags,
    custom_fields: {
      cpf_cnpj:       session.document               || null,
      empresa:        session.companyName             || null,
      potencia_kva:   q.kvaRange      ? String(q.kvaRange)      : null,
      tipo_contrato:  q.contractType  ? String(q.contractType)  : null,
      marca_gerador:  q.equipmentBrand                || null,
      modelo_gerador: q.equipmentModel                || null,
    },
  };
}

// ─── Auditoria em rd_sync_logs ────────────────────────────────────────────────
async function logRDSync(leadId, action, rdContactId, requestPayload, responsePayload, error = null) {
  const pool = getPool();
  if (!pool) return; // BD indisponível — skip silencioso

  try {
    await pool.query(
      `INSERT INTO rd_sync_logs
         (lead_id, action, rd_contact_id, request_payload, response_payload, error_message, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        leadId,
        action,
        rdContactId   || null,
        requestPayload  ? JSON.stringify(requestPayload)  : null,
        responsePayload ? JSON.stringify(responsePayload) : null,
        error           ? error.message                   : null,
      ]
    );
  } catch (dbErr) {
    logger.error(`rdSyncLog insert error: ${dbErr.message}`);
  }
}

// ─── Atualiza status no registro de lead ─────────────────────────────────────
async function updateLeadRdStatus(localLeadId, rdContactId, status, errorMessage = null) {
  const pool = getPool();
  if (!pool) return;

  try {
    await pool.query(
      `UPDATE leads SET
         rd_contact_id  = $1,
         rd_synced_at   = NOW(),
         rd_sync_status = $2,
         rd_sync_error  = $3
       WHERE id = $4`,
      [rdContactId || null, status, errorMessage || null, localLeadId]
    );
  } catch (dbErr) {
    logger.error(`rdSyncLog updateLeadRdStatus error [lead_id=${localLeadId}]: ${dbErr.message}`);
  }
}

// ─── syncLeadToRD ─────────────────────────────────────────────────────────────
async function syncLeadToRD(session, localLeadId) {
  // 1. Feature flag
  if (process.env.RD_ENABLED === 'false') {
    logger.debug('rdSync: RD_ENABLED=false, skip');
    return { skipped: true, reason: 'RD disabled' };
  }

  // 2. Regra de negócio: só sincroniza ICP ou quem optou pela newsletter
  if (!session.isIcp && !session.optInNewsletter) {
    logger.info(`rdSync: lead_id=${localLeadId} fora do ICP sem opt-in, skip`);
    return { skipped: true, reason: 'not ICP and no newsletter opt-in' };
  }

  // 3. Email obrigatório
  if (!session.email || !session.email.includes('@')) {
    logger.warn(`rdSync: lead_id=${localLeadId} sem email válido, skip`);
    return { skipped: true, reason: 'invalid email' };
  }

  // 4. BD disponível?
  const pool = getPool();
  if (!pool) {
    logger.warn(`rdSync: lead_id=${localLeadId} banco indisponível, skip`);
    return { skipped: true, reason: 'DB unavailable' };
  }

  const payload = buildPayload(session);
  let action       = 'create';
  let rdContactId  = null;

  try {
    // 5. Verifica se já tem rd_contact_id salvo
    const { rows } = await pool.query(
      'SELECT rd_contact_id FROM leads WHERE id = $1',
      [localLeadId]
    );
    rdContactId = rows[0]?.rd_contact_id || null;

    let result;

    if (rdContactId) {
      // 6a. Já existe → atualizar
      action = 'update';
      logger.info(`rdSync: lead_id=${localLeadId} atualizando rd_contact_id=${rdContactId}`);
      result = await rdService.updateContact(rdContactId, payload);
    } else {
      // 6b. Novo → criar
      action = 'create';
      logger.info(`rdSync: lead_id=${localLeadId} criando contato (${session.email})`);
      result = await rdService.createContact(payload);

      if (!result) {
        // createContact retornou null = EMAIL_ALREADY_IN_USE → buscar id existente
        logger.info(`rdSync: email já existe na RD, buscando contato (${session.email})`);
        const existing = await rdService.getContact(session.email);
        if (existing?.id) {
          rdContactId = existing.id;
          action = 'update';
          result = await rdService.updateContact(rdContactId, payload);
        }
      }

      if (result?.id) rdContactId = result.id;
    }

    // 7. Atualiza BD local
    await updateLeadRdStatus(localLeadId, rdContactId, 'synced');

    // 8. Auditoria
    await logRDSync(localLeadId, action, rdContactId, payload, result, null);

    logger.info(`rdSync: lead_id=${localLeadId} sincronizado com sucesso (action=${action} rd_id=${rdContactId})`);
    return { synced: true, action, rdContactId };

  } catch (err) {
    logger.error(`rdSync: lead_id=${localLeadId} falhou (action=${action}): ${err.message}`);

    // 9. Persiste o erro no BD
    await updateLeadRdStatus(localLeadId, rdContactId, 'error', err.message);
    await logRDSync(localLeadId, action, rdContactId, payload, null, err);

    throw err; // re-lança para o caller tratar (fire-and-forget no persistLead)
  }
}

module.exports = { syncLeadToRD, logRDSync };

// =============================================================================
// EXEMPLOS DE USO
// =============================================================================
//
// import em botHandler.js (fire-and-forget dentro de persistLead):
//
//   const { syncLeadToRD } = require('../database/rdStationRepository');
//
//   function persistLead(session) {
//     saveLead(session)
//       .then(lead => {
//         if (lead) {
//           saveSession(session.phoneNumber, session, lead.id);
//           // fire-and-forget: não bloqueia, erro é logado
//           syncLeadToRD(session, lead.id).catch(err =>
//             logger.error(`syncLeadToRD error lead=${lead.id}: ${err.message}`)
//           );
//         }
//       })
//       .catch(err => logger.error(`persistLead error: ${err.message}`));
//   }
//
// Schema necessário (adicionar ao schema.sql):
//
//   ALTER TABLE leads ADD COLUMN IF NOT EXISTS rd_contact_id  BIGINT;
//   ALTER TABLE leads ADD COLUMN IF NOT EXISTS rd_synced_at   TIMESTAMP WITH TIME ZONE;
//   ALTER TABLE leads ADD COLUMN IF NOT EXISTS rd_sync_status VARCHAR(20);
//   ALTER TABLE leads ADD COLUMN IF NOT EXISTS rd_sync_error  TEXT;
//
//   CREATE TABLE IF NOT EXISTS rd_sync_logs (
//     id               SERIAL PRIMARY KEY,
//     lead_id          INTEGER REFERENCES leads(id) ON DELETE SET NULL,
//     action           VARCHAR(10) NOT NULL,   -- 'create' | 'update'
//     rd_contact_id    BIGINT,
//     request_payload  JSONB,
//     response_payload JSONB,
//     error_message    TEXT,
//     created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
//   );
//
//   CREATE INDEX IF NOT EXISTS idx_rd_sync_logs_lead_id ON rd_sync_logs(lead_id);
