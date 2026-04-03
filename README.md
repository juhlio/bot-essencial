# Essencial Bot — WhatsApp Bot de Atendimento

Bot de atendimento via WhatsApp para qualificação de leads, construído com **Node.js**, **Express** e **Twilio**. Suporta sessões em memória ou Redis, deploy via Docker e integração com a BrasilAPI para consulta de CNPJ.

---

## Sumário

- [Visão Geral](#visão-geral)
- [Estrutura do Projeto](#estrutura-do-projeto)
- [Instalação Local](#instalação-local)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Rodando com Docker](#rodando-com-docker)
- [Endpoints](#endpoints)
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
│   ├── handlers/
│   │   └── botHandler.js         # Máquina de estados do bot
│   ├── services/
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
│   └── botHandler.test.js
├── Dockerfile
├── docker-compose.yml
├── docker-compose.dev.yml
├── docker-compose.redis.yml
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

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Status do serviço, sessões ativas e uptime |
| `POST` | `/webhook` | Recebe mensagens do Twilio e retorna TwiML |
| `POST` | `/status` | Callback de status de entrega do Twilio |

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
       ├── awaiting_segment → awaiting_kva | awaiting_contract | awaiting_brand
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

50 testes com o runner nativo do Node.js (`node:test`). Sem dependências externas de teste.

Cobertura:
- **validators.test.js** — CPF, CNPJ, e-mail, telefone, formatação, opções (37 testes)
- **botHandler.test.js** — 6 fluxos completos: venda, fora do ICP, locação, manutenção, maxErrors, reset (13 testes)

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
