# Essencial Bot — WhatsApp Bot de Atendimento

Bot de atendimento via WhatsApp para qualificação de leads, construído com **Node.js**, **Express** e **Twilio**. Suporta sessões em memória ou Redis, deploy via Docker e integração com a BrasilAPI para consulta de CNPJ.

---

## Sumário

- [Visão Geral](#visão-geral)
- [Estrutura do Projeto](#estrutura-do-projeto)
- [Instalação Local](#instalação-local)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Rodando com Docker](#rodando-com-docker)
- [Rodando com PostgreSQL](#rodando-com-postgresql)
- [Dashboard](#dashboard)
- [Editor de Mensagens](#editor-de-mensagens)
- [Endpoints](#endpoints)
- [API de Consulta](#api-de-consulta)
- [Fluxo de Atendimento](#fluxo-de-atendimento)
- [Testes](#testes)
- [Referência Rápida](#referência-rápida)

---

## Visão Geral

O bot conduz o visitante por um fluxo de qualificação:

1. Identificação (nome, CPF/CNPJ, e-mail, telefone)
2. Segmentação (Compra, Locação ou Manutenção de Gerador)
3. Coleta de dados técnicos (faixa de kVA, tipo de contrato, marca/modelo)
4. Encerramento com resumo e encaminhamento para equipe comercial ou técnica

Leads fora do ICP (geradores < 50 kVA) são tratados separadamente com opção de opt-in em newsletter.

---

## Estrutura do Projeto

```
essencial-bot/
├── src/
│   ├── index.js                  # Servidor Express + endpoints
│   ├── public/
│   │   ├── index.html            # Dashboard web
│   │   ├── css/style.css         # Estilos
│   │   └── js/
│   │       ├── api.js            # Chamadas à API
│   │       ├── charts.js         # Gráficos Chart.js
│   │       └── app.js            # Lógica principal
│   ├── handlers/
│   │   └── botHandler.js         # Máquina de estados do bot
│   ├── database/
│   │   ├── schema.sql            # Schema das tabelas
│   │   ├── migrate.js            # Script de migração
│   │   ├── leadRepository.js     # CRUD de leads
│   │   └── dashboardRepository.js # Queries agregadas para o dashboard
│   ├── services/
│   │   ├── database.js           # Pool de conexão PostgreSQL
│   │   ├── sessionStore.js       # Roteador memória/Redis
│   │   ├── redisSessionStore.js  # Backend Redis com fallback
│   │   └── cnpjService.js        # Consulta BrasilAPI
│   ├── validators/
│   │   └── validators.js         # CPF, CNPJ, e-mail, telefone
│   └── utils/
│       ├── logger.js             # Winston (console + arquivos)
│       └── messages.js           # Templates de mensagens
├── tests/
│   ├── validators.test.js
│   ├── botHandler.test.js
│   └── leadRepository.test.js
├── Dockerfile
├── docker-compose.yml
├── docker-compose.dev.yml
├── docker-compose.redis.yml
├── docker-compose.postgres.yml
├── .env.example
└── package.json
```

---

## Instalação Local

**Pré-requisitos:** Node.js >= 18

```bash
git clone https://github.com/juhlio/bot-essencial.git
cd essencial-bot
npm install
cp .env.example .env   # preencha as credenciais
npm run dev
```

---

## Variáveis de Ambiente

| Variável | Descrição | Padrão |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | Account SID do Twilio | — |
| `TWILIO_AUTH_TOKEN` | Auth Token do Twilio | — |
| `TWILIO_WHATSAPP_NUMBER` | Número WhatsApp Twilio | `whatsapp:+14155238886` |
| `PORT` | Porta do servidor | `3000` |
| `NODE_ENV` | Ambiente | `development` |
| `BOT_REMINDER_TIMEOUT_MIN` | Minutos até lembrete de inatividade | `10` |
| `BOT_CLOSE_TIMEOUT_MIN` | Minutos até encerrar sessão inativa | `40` |
| `CNPJ_API_URL` | URL base da BrasilAPI | `https://brasilapi.com.br/api/cnpj/v1` |
| `DATABASE_URL` | URL de conexão PostgreSQL (opcional) | vazio = sem persistência |
| `REDIS_URL` | URL do Redis (opcional) | vazio = memória |
| `LOG_LEVEL` | Nível de log do Winston | `info` |

---

## Rodando com Docker

### Pré-requisitos

- Docker 20+
- Docker Compose v2 (`docker compose` sem hífen)

---

### Início rápido

```bash
# 1. Configure as variáveis de ambiente
cp .env.example .env
# Edite .env com suas credenciais Twilio

# 2. Suba o container
docker compose up -d --build

# 3. Acompanhe os logs
docker compose logs -f bot
```

O servidor estará disponível em `http://localhost:3000`.

---

### Desenvolvimento com hot-reload

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

O código-fonte é montado via volume (`- .:/app`), portanto qualquer edição local é refletida automaticamente no container sem necessidade de rebuild. O `nodemon` reinicia o processo a cada alteração.

---

### Com Redis (sessões persistentes)

```bash
docker compose -f docker-compose.yml -f docker-compose.redis.yml up -d --build
```

Ao usar Redis, as sessões sobrevivem a restarts do container. Sem Redis, as sessões ficam em memória e são perdidas ao reiniciar.

O serviço Redis sobe com persistência (`appendonly yes`), limite de 128MB e política `allkeys-lru`. Se o Redis ficar indisponível, o bot faz fallback automático para memória e reconecta quando o Redis voltar.

---

### Comandos úteis

```bash
# Acompanhar logs em tempo real
docker compose logs -f bot

# Verificar saúde do serviço
curl http://localhost:3000/health

# Parar os containers
docker compose down

# Parar e remover volumes (apaga dados do Redis e logs)
docker compose down -v

# Rebuild e reiniciar
docker compose up -d --build

# Ver sessões ativas no Redis
docker compose exec redis redis-cli keys "session:*"
```

---

---

## Rodando com PostgreSQL

O bot persiste leads e sessões no PostgreSQL quando `DATABASE_URL` está definida. Sem banco, funciona normalmente — os dados ficam nos logs como fallback.

As migrações rodam automaticamente na inicialização do servidor.

### Somente PostgreSQL

```bash
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d --build
```

### PostgreSQL + Redis (recomendado para produção)

```bash
docker compose -f docker-compose.yml -f docker-compose.redis.yml -f docker-compose.postgres.yml up -d --build
```

### Rodando migrações manualmente

```bash
npm run migrate
```

---

### Deploy em produção com Docker

Em qualquer servidor com Docker instalado, o deploy é:

```bash
git clone https://github.com/juhlio/bot-essencial.git
cd essencial-bot
cp .env.example .env   # configure as credenciais
docker compose up -d --build
```

Depois, configure o webhook no painel do Twilio apontando para:

```
https://seu-dominio.com/webhook
```

#### Nginx como reverse proxy (recomendado)

Para expor o bot com HTTPS usando Nginx + Let's Encrypt:

```nginx
# /etc/nginx/sites-available/essencial-bot
server {
    listen 80;
    server_name seu-dominio.com;

    # Redireciona HTTP para HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name seu-dominio.com;

    ssl_certificate     /etc/letsencrypt/live/seu-dominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/seu-dominio.com/privkey.pem;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

Obter certificado SSL com Certbot:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d seu-dominio.com
```

---

## Dashboard

O bot inclui um dashboard web para visualizar leads e métricas em tempo real. Requer `DATABASE_URL` configurada.

Acesse em: **`http://localhost:3000/dashboard`**

### Funcionalidades

- Cards com métricas consolidadas (total, ICP, por segmento, hoje / 7 dias / 30 dias)
- Gráfico de leads por dia com seletor de período (7, 30 ou 90 dias)
- Gráfico de distribuição por segmento (donut)
- Funil de conversão (sessões → leads qualificados)
- Tabela de leads com filtros por segmento, ICP e período + paginação
- Modal com todos os dados coletados de cada lead
- Exportação para CSV com filtros ativos (abre corretamente no Excel com acentos)
- Auto-refresh de métricas a cada 60 segundos sem perder filtros da tabela
- Indicador de status do banco e contador de sessões ativas no header

### Exemplo rápido

```bash
# Subir com banco (necessário para o dashboard)
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d --build

# Acessar o dashboard
open http://localhost:3000/dashboard

# Exportar todos os leads como CSV
curl -o leads.csv http://localhost:3000/api/leads/export/csv

# Exportar apenas leads ICP do segmento venda
curl -o leads_venda_icp.csv "http://localhost:3000/api/leads/export/csv?segment=venda&is_icp=true"
```

---

## Editor de Mensagens

O dashboard inclui um editor para personalizar todas as mensagens do bot sem alterar código.

Acesse em: **`http://localhost:3000/dashboard`** → aba **Mensagens**

### Funcionalidades

- Edição de todas as mensagens por categoria (Saudação, Identificação, Segmentação, etc.)
- Preview em tempo real com formatação WhatsApp (`*negrito*`, `_itálico_`, `~riscado~`)
- Inserção rápida de variáveis (`{{name}}`, `{{company}}`, etc.) com clique no chip
- Restauração individual ou total para mensagens originais
- Validação de variáveis obrigatórias antes de salvar (ex: `{{name}}` não pode ser removido de `askDocument`)
- Fallback automático para mensagens originais se banco indisponível

### Seed inicial

Ao subir pela primeira vez com banco, execute o seed para popular os templates:

```bash
npm run seed
```

Isso é idempotente — pode ser executado múltiplas vezes sem duplicar registros.

---

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Status do serviço, sessões ativas, banco e uptime |
| `GET` | `/dashboard` | Dashboard web de leads e métricas |
| `GET` | `/api/leads` | Lista leads com filtros e paginação |
| `GET` | `/api/leads/:id` | Detalhes de um lead específico |
| `GET` | `/api/leads/export/csv` | Exportar leads filtrados em CSV |
| `GET` | `/api/dashboard/stats` | Métricas consolidadas |
| `GET` | `/api/dashboard/leads-por-dia` | Leads por dia (últimos N dias, padrão 30) |
| `GET` | `/api/dashboard/funil` | Dados do funil de conversão |
| `GET` | `/api/dashboard/segmentos` | Breakdown por segmento |
| `GET` | `/api/messages` | Lista todos os templates de mensagens |
| `GET` | `/api/messages/:key` | Template de mensagem específico |
| `PUT` | `/api/messages/:key` | Atualiza texto de um template |
| `POST` | `/api/messages/reset` | Restaura mensagens originais (key ou todas) |
| `POST` | `/api/messages/preview` | Preview de mensagem com variáveis |
| `POST` | `/webhook` | Recebe mensagens do Twilio e retorna TwiML |
| `POST` | `/status` | Callback de status de entrega do Twilio |

---

## API de Consulta

O endpoint `GET /api/leads` permite consultar os leads salvos no banco.

### Parâmetros de query

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `segment` | string | Filtrar por segmento: `venda`, `locacao`, `manutencao` |
| `is_icp` | boolean | Filtrar por ICP: `true` ou `false` |
| `date_from` | ISO 8601 | Data inicial (ex: `2026-01-01`) |
| `date_to` | ISO 8601 | Data final (ex: `2026-12-31`) |
| `limit` | number | Máximo de resultados (default `50`, máx `200`) |
| `offset` | number | Offset para paginação (default `0`) |

### Exemplos

```bash
# Listar todos os leads
curl http://localhost:3000/api/leads

# Filtrar por segmento e ICP
curl http://localhost:3000/api/leads?segment=venda&is_icp=true

# Paginação
curl http://localhost:3000/api/leads?limit=10&offset=20

# Filtrar por período
curl "http://localhost:3000/api/leads?date_from=2026-01-01&date_to=2026-12-31"
```

### Resposta

```json
{
  "total": 42,
  "limit": 50,
  "offset": 0,
  "leads": [...]
}
```

Retorna `503` se o banco não estiver configurado.

---

## Fluxo de Atendimento

```
Mensagem recebida
       │
       ▼
  Keyword reset? ──── sim ──→ Reset sessão → Greeting
       │ não
       ▼
  Sessão completed? ── sim ─→ Reset sessão → Greeting
       │ não
       ▼
  stepHandlers[session.step]
       │
       ├── greeting        → awaiting_name
       ├── awaiting_name   → awaiting_document
       ├── awaiting_document → awaiting_email (+ lookup CNPJ)
       ├── awaiting_email  → awaiting_phone
       ├── awaiting_phone  → awaiting_segment
       ├── awaiting_segment → awaiting_location
       ├── awaiting_location → awaiting_kva | awaiting_contract | awaiting_brand
       ├── awaiting_kva    → closing (ICP) | awaiting_newsletter_optin (fora do ICP)
       ├── awaiting_contract → closing
       ├── awaiting_brand  → awaiting_model
       └── awaiting_model  → closing
```

Cada step possui controle de erros: após 3 entradas inválidas consecutivas, o bot encerra a conversa e indica o telefone de suporte `0800 779 9009`.

---

## Testes

```bash
npm test
```

87 testes com o runner nativo do Node.js (`node:test`). Sem dependências externas de teste. Não requer banco de dados ou Redis rodando.

Cobertura:
- **validators.test.js** — CPF, CNPJ, e-mail, telefone, formatação, opções (37 testes)
- **botHandler.test.js** — 6 fluxos completos: venda, fora do ICP, locação, manutenção, maxErrors, reset (13 testes)
- **leadRepository.test.js** — degradação graciosa sem banco e integração fire-and-forget (12 testes)
- **messageRepository.test.js** — resolveMessage sem banco, substituição de variáveis, cache, fallback via getMessage (12 testes)
- **messageApi.test.js** — endpoints GET/PUT/POST de mensagens: estrutura, 404, validações 400, 503 sem banco, preview HTML (13 testes)

---

## Referência Rápida

| Comando | Descrição |
|---|---|
| `npm run dev` | Inicia com nodemon (hot-reload local) |
| `npm start` | Inicia em produção |
| `npm test` | Executa todos os testes |
| `docker compose up -d --build` | Sobe em produção com Docker |
| `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build` | Sobe em desenvolvimento com Docker |
| `docker compose -f docker-compose.yml -f docker-compose.redis.yml up -d --build` | Sobe com Redis |
| `docker compose logs -f bot` | Acompanha logs do container |
| `docker compose down` | Para os containers |
| `docker compose down -v` | Para e remove volumes |
| `docker compose exec redis redis-cli keys "session:*"` | Lista sessões no Redis |
| `curl http://localhost:3000/health` | Verifica saúde do serviço |
| `curl http://localhost:3000/api/leads` | Lista leads salvos no banco |
| `npm run migrate` | Cria/atualiza tabelas no banco |
| `docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d --build` | Sobe com PostgreSQL |
| `docker compose -f docker-compose.yml -f docker-compose.redis.yml -f docker-compose.postgres.yml up -d --build` | Sobe com PostgreSQL + Redis |
