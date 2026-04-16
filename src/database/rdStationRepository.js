const rdService = require('../services/rdStationService');
const logger    = require('../utils/logger');

function getPool() {
  return require('../services/database').getPool();
}

// ─── Auditoria em rd_sync_logs ────────────────────────────────────────────────
async function logRDSync(leadId, action, requestPayload, responsePayload, error = null) {
  const pool = getPool();
  if (!pool) return;

  try {
    await pool.query(
      `INSERT INTO rd_sync_logs
         (lead_id, action, request_payload, response_payload, error_message, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        leadId,
        action,
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
async function updateLeadRdStatus(localLeadId, status, errorMessage = null) {
  const pool = getPool();
  if (!pool) return;

  try {
    await pool.query(
      `UPDATE leads SET
         rd_synced_at   = NOW(),
         rd_sync_status = $1,
         rd_sync_error  = $2
       WHERE id = $3`,
      [status, errorMessage || null, localLeadId]
    );
  } catch (dbErr) {
    logger.error(`rdSyncLog updateLeadRdStatus error [lead_id=${localLeadId}]: ${dbErr.message}`);
  }
}

// ─── syncLeadToRD ─────────────────────────────────────────────────────────────
async function syncLeadToRD(session, localLeadId) {
  // 1. Regra de negócio: só sincroniza ICP ou quem optou pela newsletter
  if (!session.isIcp && !session.optInNewsletter) {
    logger.info(`rdSync: lead_id=${localLeadId} fora do ICP sem opt-in, skip`);
    return { skipped: true, reason: 'not ICP and no newsletter opt-in' };
  }

  // 2. Email obrigatório
  if (!session.email || !session.email.includes('@')) {
    logger.warn(`rdSync: lead_id=${localLeadId} sem email válido, skip`);
    return { skipped: true, reason: 'invalid email' };
  }

  const payload = rdService.buildRdPayload(session);

  try {
    const result = await rdService.sendConversion(session);

    if (!result.success && result.reason === 'disabled') {
      return { skipped: true, reason: 'RD disabled' };
    }

    if (result.success) {
      await updateLeadRdStatus(localLeadId, 'synced');
      await logRDSync(localLeadId, 'conversion', payload, result, null);
      logger.info(`rdSync: lead_id=${localLeadId} conversão enviada com sucesso`);
      return { synced: true, action: 'conversion' };
    }

    // HTTP error (não lançou exceção, mas success=false)
    const errMsg = result.error || `HTTP ${result.status}`;
    await updateLeadRdStatus(localLeadId, 'error', errMsg);
    await logRDSync(localLeadId, 'conversion', payload, result, new Error(errMsg));
    return { synced: false, error: errMsg };

  } catch (err) {
    logger.error(`rdSync: lead_id=${localLeadId} falhou: ${err.message}`);
    await updateLeadRdStatus(localLeadId, 'error', err.message);
    await logRDSync(localLeadId, 'conversion', payload, null, err);
    throw err;
  }
}

module.exports = { syncLeadToRD, logRDSync };
