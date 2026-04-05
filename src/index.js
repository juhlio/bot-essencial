require('dotenv').config();

const express = require('express');
const { twiml: { MessagingResponse } } = require('twilio');

const logger = require('./utils/logger');
const { sessionStore } = require('./services/sessionStore');
const { handleMessage } = require('./handlers/botHandler');
const path = require('path');
const { runMigrations } = require('./database/migrate');
const { listLeads, countLeads, findLeadById, exportLeads } = require('./database/leadRepository');
const { getStats, getLeadsPorDia, getFunil, getSegmentoDetalhado } = require('./database/dashboardRepository');
const { getAllMessages, getMessageByKey, updateMessage, resetMessage, resetAllMessages } = require('./database/messageRepository');
const { SEED_MESSAGES } = require('./database/seedMessages');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use('/dashboard', express.static(path.join(__dirname, 'public')));

// ─── GET /health ─────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  const db = require('./services/database');
  let dbStatus = 'not_configured';

  if (db.getPool()) {
    try {
      await db.query('SELECT 1');
      dbStatus = 'connected';
    } catch {
      dbStatus = 'error';
    }
  }

  res.json({
    status: 'ok',
    service: 'essencial-energia-whatsapp-bot',
    sessions: await sessionStore.count(),
    database: dbStatus,
    uptime: process.uptime(),
  });
});

// ─── GET /api/leads ──────────────────────────────────────────────────────────
app.get('/api/leads', async (req, res) => {
  const db = require('./services/database');
  if (!db.getPool()) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const filters = {
      limit,
      offset,
      ...(req.query.segment && { segment: req.query.segment }),
      ...(req.query.is_icp !== undefined && { is_icp: req.query.is_icp === 'true' }),
      ...(req.query.date_from && { date_from: req.query.date_from }),
      ...(req.query.date_to && { date_to: req.query.date_to }),
    };

    const [leads, total] = await Promise.all([
      listLeads(filters),
      countLeads(filters),
    ]);

    res.json({ total, limit, offset, leads });
  } catch (err) {
    logger.error(`GET /api/leads error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/leads/export/csv ───────────────────────────────────────────────
app.get('/api/leads/export/csv', async (req, res) => {
  const db = require('./services/database');
  if (!db.getPool()) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  try {
    const filters = {
      ...(req.query.segment && { segment: req.query.segment }),
      ...(req.query.is_icp !== undefined && req.query.is_icp !== '' && { is_icp: req.query.is_icp === 'true' }),
      ...(req.query.date_from && { date_from: req.query.date_from }),
      ...(req.query.date_to && { date_to: req.query.date_to }),
    };

    const leads = await exportLeads(filters);

    const KVA_LABELS = { 1: 'Até 50 kVA', 2: '50-100 kVA', 3: '100-200 kVA', 4: '200-300 kVA', 5: 'Acima de 300 kVA', 6: 'Não sei / Dimensionamento' };
    const CONTRACT_LABELS = { 1: 'Stand-by', 2: 'Prime/Contínua', 3: 'Longo Prazo', 4: 'Outro/Sob Demanda' };
    const SEGMENT_LABELS = { venda: 'Venda', locacao: 'Locação', manutencao: 'Manutenção' };

    const escape = v => {
      if (v === null || v === undefined) return '';
      const s = Array.isArray(v) ? v.join(', ') : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };

    const headers = ['ID', 'Nome', 'Tipo Documento', 'Documento', 'Empresa', 'E-mail', 'Telefone', 'Segmento', 'Faixa kVA', 'Tipo Contrato', 'Marca', 'Modelo', 'ICP', 'Newsletter', 'Tags', 'Data'];

    const rows = leads.map(l => [
      l.id,
      escape(l.name),
      escape(l.document_type),
      escape(l.document),
      escape(l.company_name),
      escape(l.email),
      escape(l.phone),
      escape(SEGMENT_LABELS[l.segment] || l.segment),
      escape(KVA_LABELS[l.kva_range] || l.kva_range),
      escape(CONTRACT_LABELS[l.contract_type] || l.contract_type),
      escape(l.equipment_brand),
      escape(l.equipment_model),
      l.is_icp ? 'Sim' : 'Não',
      l.opt_in_newsletter === true ? 'Sim' : l.opt_in_newsletter === false ? 'Não' : '',
      escape(l.tags),
      l.created_at ? new Date(l.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '',
    ].join(','));

    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const csv = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename=leads_${date}.csv`);
    res.send(csv);
  } catch (err) {
    logger.error(`GET /api/leads/export/csv error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/leads/:id ──────────────────────────────────────────────────────
app.get('/api/leads/:id', async (req, res) => {
  const db = require('./services/database');
  if (!db.getPool()) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const lead = await findLeadById(id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    res.json(lead);
  } catch (err) {
    logger.error(`GET /api/leads/:id error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/dashboard/* ────────────────────────────────────────────────────
function requireDb(req, res) {
  const db = require('./services/database');
  if (!db.getPool()) {
    res.status(503).json({ error: 'Database not configured' });
    return false;
  }
  return true;
}

app.get('/api/dashboard/stats', async (req, res) => {
  if (!requireDb(req, res)) return;
  try {
    res.json(await getStats());
  } catch (err) {
    logger.error(`GET /api/dashboard/stats error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/dashboard/leads-por-dia', async (req, res) => {
  if (!requireDb(req, res)) return;
  try {
    const dias = Math.min(parseInt(req.query.dias) || 30, 365);
    res.json(await getLeadsPorDia(dias));
  } catch (err) {
    logger.error(`GET /api/dashboard/leads-por-dia error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/dashboard/funil', async (req, res) => {
  if (!requireDb(req, res)) return;
  try {
    res.json(await getFunil());
  } catch (err) {
    logger.error(`GET /api/dashboard/funil error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/dashboard/segmentos', async (req, res) => {
  if (!requireDb(req, res)) return;
  try {
    res.json(await getSegmentoDetalhado());
  } catch (err) {
    logger.error(`GET /api/dashboard/segmentos error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── /api/messages/* ─────────────────────────────────────────────────────────

const CATEGORY_LABELS = {
  saudacao:               'Saudação',
  identificacao:          'Identificação',
  segmentacao:            'Segmentação',
  qualificacao_venda:     'Qualificação — Venda',
  qualificacao_locacao:   'Qualificação — Locação',
  qualificacao_manutencao:'Qualificação — Manutenção',
  fora_icp:               'Fora do Perfil (ICP)',
  encerramento:           'Encerramento',
  erros:                  'Mensagens de Erro',
  sistema:                'Sistema',
};

function groupByCategory(templates) {
  const map = new Map();
  for (const t of templates) {
    if (!map.has(t.category)) map.set(t.category, []);
    map.get(t.category).push(t);
  }
  return Array.from(map.entries()).map(([name, messages]) => ({
    name,
    label: CATEGORY_LABELS[name] || name,
    messages,
  }));
}

// GET /api/messages — sem banco retorna hardcoded com flag source:'fallback'
app.get('/api/messages', async (req, res) => {
  try {
    const db = require('./services/database');
    if (!db.getPool()) {
      const fallback = SEED_MESSAGES.map(m => ({ ...m, source: 'fallback' }));
      return res.json({ categories: groupByCategory(fallback) });
    }
    const templates = await getAllMessages();
    const source = templates.length ? 'database' : 'fallback';
    const list = templates.length
      ? templates.map(t => ({ ...t, source: 'database' }))
      : SEED_MESSAGES.map(m => ({ ...m, source: 'fallback' }));
    res.json({ categories: groupByCategory(list), source });
  } catch (err) {
    logger.error(`GET /api/messages error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/messages/:key
app.get('/api/messages/:key', async (req, res) => {
  try {
    const db = require('./services/database');
    if (!db.getPool()) {
      const seed = SEED_MESSAGES.find(m => m.key === req.params.key);
      if (!seed) return res.status(404).json({ error: 'Template not found' });
      return res.json({ ...seed, source: 'fallback' });
    }
    const template = await getMessageByKey(req.params.key);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json(template);
  } catch (err) {
    logger.error(`GET /api/messages/:key error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/messages/:key
app.put('/api/messages/:key', async (req, res) => {
  try {
    const { content, updated_by } = req.body;

    // Validações de input primeiro (antes de checar banco)
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }
    if (content.length > 2000) {
      return res.status(400).json({ error: 'content exceeds 2000 characters' });
    }

    // Garante que variáveis obrigatórias do template original são mantidas
    const seed = SEED_MESSAGES.find(m => m.key === req.params.key);
    if (seed && seed.variables && seed.variables.length > 0) {
      const missing = seed.variables.filter(v => !content.includes(`{{${v}}}`));
      if (missing.length > 0) {
        return res.status(400).json({
          error: `Missing required variables: ${missing.map(v => `{{${v}}}`).join(', ')}`,
        });
      }
    }

    if (!requireDb(req, res)) return;
    const updated = await updateMessage(req.params.key, content.trim(), updated_by || 'api');
    res.json(updated);
  } catch (err) {
    if (err.message.startsWith('Template não encontrado')) {
      return res.status(404).json({ error: err.message });
    }
    logger.error(`PUT /api/messages/:key error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/messages/reset
app.post('/api/messages/reset', async (req, res) => {
  if (!requireDb(req, res)) return;
  try {
    const { key } = req.body || {};
    if (key) {
      const result = await resetMessage(key);
      return res.json(result);
    }
    const results = await resetAllMessages();
    res.json({ reset: results.length });
  } catch (err) {
    if (err.message.startsWith('Seed não encontrado') || err.message.startsWith('Template não encontrado')) {
      return res.status(404).json({ error: err.message });
    }
    logger.error(`POST /api/messages/reset error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/messages/preview
app.post('/api/messages/preview', (req, res) => {
  try {
    const { content, variables = {} } = req.body || {};
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    let preview = content;
    for (const [k, v] of Object.entries(variables)) {
      preview = preview.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v ?? '');
    }

    // Converte formatação WhatsApp (*bold*, _italic_) para HTML
    const whatsapp_preview = preview
      .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
      .replace(/_(.*?)_/g, '<em>$1</em>')
      .replace(/~(.*?)~/g, '<s>$1</s>')
      .replace(/\n/g, '<br>');

    res.json({ preview, whatsapp_preview });
  } catch (err) {
    logger.error(`POST /api/messages/preview error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /webhook ───────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const from = req.body.From || '';
  const body = (req.body.Body || '').trim();
  const profileName = req.body.ProfileName || '';

  logger.info(`Mensagem recebida de ${from} (${profileName}): ${body}`);

  const twiml = new MessagingResponse();

  try {
    const replies = await handleMessage(from, body, profileName);
    for (const reply of replies) {
      twiml.message(reply);
    }
  } catch (err) {
    logger.error(`Erro ao processar mensagem de ${from}: ${err.message}`);
    twiml.message(
      'Desculpe, ocorreu um erro inesperado. Nossa equipe já foi notificada.\n\nPlantão 24h: *0800 779 9009*'
    );
  }

  res.set('Content-Type', 'text/xml');
  res.send(twiml.toString());
});

// ─── POST /status ────────────────────────────────────────────────────────────
app.post('/status', (req, res) => {
  const { MessageSid, MessageStatus, To } = req.body;
  logger.info(`Status [${MessageSid}] → ${MessageStatus} para ${To}`);
  res.sendStatus(200);
});

// ─── Limpeza periódica de sessões ────────────────────────────────────────────
setInterval(async () => {
  const removed = await sessionStore.cleanExpired();
  if (removed > 0) {
    logger.info(`Limpeza de sessões: ${removed} sessão(ões) expirada(s) removida(s)`);
  }
}, 5 * 60 * 1000);

// ─── Start ───────────────────────────────────────────────────────────────────
async function startServer() {
  if (process.env.DATABASE_URL) {
    try {
      await runMigrations();
      logger.info('Migrações do banco executadas com sucesso');
    } catch (err) {
      logger.error(`Erro ao executar migrações: ${err.message}`);
      logger.warn('Bot iniciando sem persistência no banco de dados');
    }
  }

  app.listen(PORT, () => {
    logger.info(`🚀 Essencial Bot rodando na porta ${PORT}`);
    logger.info(`📱 Webhook URL: http://localhost:${PORT}/webhook`);
    logger.info(`💚 Health check URL: http://localhost:${PORT}/health`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = app;
