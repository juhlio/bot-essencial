require('dotenv').config();

const express = require('express');
const { twiml: { MessagingResponse } } = require('twilio');

const logger = require('./utils/logger');
const { sessionStore } = require('./services/sessionStore');
const { handleMessage } = require('./handlers/botHandler');
const { runMigrations } = require('./database/migrate');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

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
