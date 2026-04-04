const logger = require('../utils/logger');

function getPool() {
  return require('../services/database').getPool();
}

// ─── getStats ─────────────────────────────────────────────────────────────────
async function getStats() {
  const pool = getPool();
  if (!pool) return { total: 0, icp: 0, fora_icp: 0, por_segmento: {}, newsletter: 0, hoje: 0, semana: 0, mes: 0 };

  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)::INTEGER                                                        AS total,
        COUNT(*) FILTER (WHERE is_icp = true)::INTEGER                          AS icp,
        COUNT(*) FILTER (WHERE is_icp = false)::INTEGER                         AS fora_icp,
        COUNT(*) FILTER (WHERE segment = 'venda')::INTEGER                      AS venda,
        COUNT(*) FILTER (WHERE segment = 'locacao')::INTEGER                    AS locacao,
        COUNT(*) FILTER (WHERE segment = 'manutencao')::INTEGER                 AS manutencao,
        COUNT(*) FILTER (WHERE opt_in_newsletter = true)::INTEGER               AS newsletter,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::INTEGER             AS hoje,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::INTEGER  AS semana,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::INTEGER AS mes
      FROM leads
    `);

    const r = rows[0];
    return {
      total: r.total,
      icp: r.icp,
      fora_icp: r.fora_icp,
      por_segmento: { venda: r.venda, locacao: r.locacao, manutencao: r.manutencao },
      newsletter: r.newsletter,
      hoje: r.hoje,
      semana: r.semana,
      mes: r.mes,
    };
  } catch (err) {
    logger.error(`getStats error: ${err.message}`);
    return { total: 0, icp: 0, fora_icp: 0, por_segmento: {}, newsletter: 0, hoje: 0, semana: 0, mes: 0 };
  }
}

// ─── getLeadsPorDia ───────────────────────────────────────────────────────────
async function getLeadsPorDia(dias = 30) {
  const pool = getPool();
  if (!pool) return [];

  try {
    const { rows } = await pool.query(`
      SELECT
        d.date::DATE                                                           AS date,
        COUNT(l.id)::INTEGER                                                   AS total,
        COUNT(l.id) FILTER (WHERE l.is_icp = true)::INTEGER                   AS icp,
        COUNT(l.id) FILTER (WHERE l.is_icp = false)::INTEGER                  AS fora_icp
      FROM generate_series(
        (CURRENT_DATE - ($1::INTEGER - 1) * INTERVAL '1 day'),
        CURRENT_DATE,
        INTERVAL '1 day'
      ) AS d(date)
      LEFT JOIN leads l ON l.created_at::DATE = d.date::DATE
      GROUP BY d.date
      ORDER BY d.date ASC
    `, [dias]);

    return rows.map(r => ({
      date: r.date.toISOString().slice(0, 10),
      total: r.total,
      icp: r.icp,
      fora_icp: r.fora_icp,
    }));
  } catch (err) {
    logger.error(`getLeadsPorDia error: ${err.message}`);
    return [];
  }
}

// ─── getFunil ─────────────────────────────────────────────────────────────────
async function getFunil() {
  const pool = getPool();
  if (!pool) return { sessoes_iniciadas: 0, sessoes_completadas: 0, leads_icp: 0, leads_fora_icp: 0, taxa_conclusao: 0, taxa_icp: 0 };

  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::INTEGER FROM sessions)                                       AS sessoes_iniciadas,
        (SELECT COUNT(*)::INTEGER FROM sessions WHERE completed = true)                AS sessoes_completadas,
        (SELECT COUNT(*)::INTEGER FROM leads WHERE is_icp = true)                      AS leads_icp,
        (SELECT COUNT(*)::INTEGER FROM leads WHERE is_icp = false)                     AS leads_fora_icp,
        (SELECT COUNT(*)::INTEGER FROM leads)                                          AS total_leads
    `);

    const r = rows[0];
    const taxa_conclusao = r.sessoes_iniciadas > 0
      ? Math.round((r.sessoes_completadas / r.sessoes_iniciadas) * 100)
      : 0;
    const taxa_icp = r.total_leads > 0
      ? Math.round((r.leads_icp / r.total_leads) * 100)
      : 0;

    return {
      sessoes_iniciadas: r.sessoes_iniciadas,
      sessoes_completadas: r.sessoes_completadas,
      leads_icp: r.leads_icp,
      leads_fora_icp: r.leads_fora_icp,
      taxa_conclusao,
      taxa_icp,
    };
  } catch (err) {
    logger.error(`getFunil error: ${err.message}`);
    return { sessoes_iniciadas: 0, sessoes_completadas: 0, leads_icp: 0, leads_fora_icp: 0, taxa_conclusao: 0, taxa_icp: 0 };
  }
}

// ─── getSegmentoDetalhado ─────────────────────────────────────────────────────
async function getSegmentoDetalhado() {
  const pool = getPool();
  if (!pool) return { venda: {}, locacao: {}, manutencao: { total: 0 } };

  try {
    const { rows } = await pool.query(`
      SELECT
        segment,
        kva_range,
        contract_type,
        COUNT(*)::INTEGER AS total
      FROM leads
      GROUP BY segment, kva_range, contract_type
      ORDER BY segment, total DESC
    `);

    const result = { venda: {}, locacao: {}, manutencao: { total: 0 } };

    for (const row of rows) {
      if (row.segment === 'venda') {
        const key = row.kva_range ? `kva_${row.kva_range}` : 'nao_informado';
        result.venda[key] = (result.venda[key] || 0) + row.total;
      } else if (row.segment === 'locacao') {
        const key = row.contract_type ? `contrato_${row.contract_type}` : 'nao_informado';
        result.locacao[key] = (result.locacao[key] || 0) + row.total;
      } else if (row.segment === 'manutencao') {
        result.manutencao.total += row.total;
      }
    }

    return result;
  } catch (err) {
    logger.error(`getSegmentoDetalhado error: ${err.message}`);
    return { venda: {}, locacao: {}, manutencao: { total: 0 } };
  }
}

module.exports = { getStats, getLeadsPorDia, getFunil, getSegmentoDetalhado };
