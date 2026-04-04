require('dotenv').config();

const express = require('express');
const { twiml: { MessagingResponse } } = require('twilio');

const logger = require('./utils/logger');
const { sessionStore } = require('./services/sessionStore');
const { handleMessage } = require('./handlers/botHandler');
const path = require('path');
const { runMigrations } = require('./database/migrate');
const { listLeads, countLeads, findLeadById } = require('./database/leadRepository');
const { getStats, getLeadsPorDia, getFunil, getSegmentoDetalhado } = require('./database/dashboardRepository');

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

startServer();
