#!/usr/bin/env bash
set -euo pipefail

# ─── Configurações ────────────────────────────────────────────────────────────
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$APP_DIR/docker-compose.yml"
ENV_FILE="$APP_DIR/.env"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()    { echo -e "${BLUE}[deploy]${NC} $*"; }
ok()     { echo -e "${GREEN}[ok]${NC} $*"; }
warn()   { echo -e "${YELLOW}[aviso]${NC} $*"; }
error()  { echo -e "${RED}[erro]${NC} $*" >&2; exit 1; }

# ─── Pré-requisitos ───────────────────────────────────────────────────────────
check_deps() {
  for cmd in docker git; do
    command -v "$cmd" &>/dev/null || error "Comando '$cmd' não encontrado. Instale antes de prosseguir."
  done
  docker compose version &>/dev/null || error "Docker Compose (plugin v2) não encontrado."
}

check_env() {
  [[ -f "$ENV_FILE" ]] || error ".env não encontrado em $APP_DIR. Copie .env.example e preencha as variáveis."

  local missing=()
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "$line" ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    [[ -z "$value" ]] && missing+=("$key")
  done < <(grep -E "^(JWT_SECRET|EVOLUTION_API_KEY)=" "$ENV_FILE")

  if [[ ${#missing[@]} -gt 0 ]]; then
    for k in "${missing[@]}"; do
      warn "Variável obrigatória sem valor: $k"
    done
    error "Preencha as variáveis acima no .env antes de fazer deploy."
  fi
}

# ─── Etapas do deploy ─────────────────────────────────────────────────────────
pull_latest() {
  log "Atualizando código do repositório..."
  cd "$APP_DIR"
  git fetch origin
  local behind
  behind=$(git rev-list HEAD..origin/main --count 2>/dev/null || echo 0)
  if [[ "$behind" -gt 0 ]]; then
    git pull --ff-only origin main
    ok "Código atualizado ($behind commit(s) novos)"
  else
    ok "Código já está na versão mais recente"
  fi
}

build_image() {
  log "Fazendo build da imagem do bot..."
  docker compose -f "$COMPOSE_FILE" build --no-cache bot
  ok "Build concluído"
}

pull_images() {
  log "Atualizando imagens externas (postgres, redis, evolution)..."
  docker compose -f "$COMPOSE_FILE" pull postgres redis evolution
  ok "Imagens externas atualizadas"
}

start_services() {
  log "Subindo serviços..."
  docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
  ok "Serviços iniciados"
}

wait_healthy() {
  local service="$1"
  local max_wait="${2:-60}"
  local elapsed=0

  log "Aguardando $service ficar saudável..."
  while [[ $elapsed -lt $max_wait ]]; do
    local state
    state=$(docker inspect --format='{{.State.Health.Status}}' "essencial-$service" 2>/dev/null || echo "unknown")
    if [[ "$state" == "healthy" ]]; then
      ok "$service está saudável"
      return 0
    fi
    sleep 3
    elapsed=$((elapsed + 3))
  done
  error "$service não ficou saudável em ${max_wait}s. Verifique: docker logs essencial-$service"
}

run_migrations() {
  local db_url
  db_url=$(grep -E "^DATABASE_URL=" "$ENV_FILE" | cut -d= -f2-)
  if [[ -z "$db_url" ]]; then
    warn "DATABASE_URL não configurado — pulando migrations"
    return 0
  fi
  log "Executando migrations..."
  docker compose -f "$COMPOSE_FILE" exec -T bot node src/db/migrate.js 2>/dev/null \
    && ok "Migrations concluídas" \
    || warn "Script de migration não encontrado ou falhou — verifique manualmente"
}

show_status() {
  echo ""
  log "Status dos serviços:"
  docker compose -f "$COMPOSE_FILE" ps
  echo ""
  ok "Deploy concluído com sucesso!"
}

# ─── Modo rollback ────────────────────────────────────────────────────────────
rollback() {
  warn "Iniciando rollback para o commit anterior..."
  cd "$APP_DIR"
  git checkout HEAD~1
  build_image
  start_services
  ok "Rollback concluído. Lembre-se de investigar o problema antes de fazer novo deploy."
}

# ─── Main ─────────────────────────────────────────────────────────────────────
usage() {
  echo "Uso: $0 [--rollback | --restart | --logs | --status]"
  echo ""
  echo "  (sem argumento)  Deploy completo: pull → build → up"
  echo "  --rollback       Volta ao commit anterior e reinicia"
  echo "  --restart        Reinicia os containers sem rebuild"
  echo "  --logs           Exibe logs em tempo real"
  echo "  --status         Mostra status dos serviços"
  exit 0
}

main() {
  local mode="${1:-deploy}"

  case "$mode" in
    --help|-h)   usage ;;
    --rollback)  check_deps; rollback ;;
    --restart)
      check_deps
      log "Reiniciando serviços..."
      docker compose -f "$COMPOSE_FILE" restart
      ok "Serviços reiniciados"
      ;;
    --logs)
      docker compose -f "$COMPOSE_FILE" logs -f --tail=100
      ;;
    --status)
      docker compose -f "$COMPOSE_FILE" ps
      ;;
    deploy)
      check_deps
      check_env
      pull_latest
      pull_images
      build_image
      start_services
      wait_healthy postgres 60
      wait_healthy redis 30
      wait_healthy bot 60
      run_migrations
      show_status
      ;;
    *)
      error "Argumento desconhecido: $mode. Use --help para ver as opções."
      ;;
  esac
}

main "${1:-deploy}"
