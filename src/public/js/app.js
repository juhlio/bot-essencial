// ── Mapeamentos ───────────────────────────────────────────────────────────────
const KVA_LABELS = {
  1: 'Até 50 kVA',
  2: '50–100 kVA',
  3: '100–200 kVA',
  4: '200–300 kVA',
  5: 'Acima de 300 kVA',
  6: 'Não sei / Dimensionamento',
};
const CONTRACT_LABELS = {
  1: 'Stand-by',
  2: 'Prime/Contínua',
  3: 'Longo Prazo',
  4: 'Outro/Sob Demanda',
};
const SEGMENT_LABELS = { venda: 'Venda', locacao: 'Locação', manutencao: 'Manutenção' };

// ── Helpers de conversas humanas ──────────────────────────────────────────────
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function timeSince(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (mins < 1)  return 'agora';
  if (mins < 60) return `${mins} min`;
  const hrs  = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest > 0 ? `${hrs}h ${rest}min` : `${hrs}h`;
}

function formatPhoneDisplay(phone) {
  const num = phone.replace(/^whatsapp:\+?/, '');
  const m = num.match(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+${m[1]} (${m[2]}) ${m[3]}-${m[4]}` : `+${num}`;
}

function phoneToWaLink(phone) {
  return `https://wa.me/${phone.replace(/^whatsapp:\+?/, '')}`;
}

// ── renderHumanConversations ──────────────────────────────────────────────────
function renderHumanConversations(list) {
  const container = $('human-conversations-list');
  const badge = $('human-count-badge');
  if (badge) badge.textContent = list.length > 0 ? ` (${list.length})` : '';

  if (!list.length) {
    container.innerHTML =
      '<div class="human-conv-empty">Nenhuma conversa em atendimento humano no momento.</div>';
    return;
  }

  const SENDER_ICON = { client: '👤', bot: '🤖', agent: '👨‍💼' };

  container.innerHTML = list.map(conv => {
    const phoneDisplay = formatPhoneDisplay(conv.phone);
    const waLink       = phoneToWaLink(conv.phone);
    const startedAt    = fmtTime(conv.human_started_at);
    const duration     = timeSince(conv.human_started_at);

    const messagesHtml = conv.last_messages && conv.last_messages.length
      ? conv.last_messages.map(m => `
          <div class="human-msg human-msg--${m.sender}">
            <span class="human-msg__icon">${SENDER_ICON[m.sender] || '💬'}</span>
            <span class="human-msg__text">${escapeHtml(m.message_text)}</span>
            <span class="human-msg__time">${fmtTime(m.created_at)}</span>
          </div>`).join('')
      : '<p class="human-msg-empty">Sem histórico de mensagens registrado.</p>';

    return `
      <div class="human-conv-card" data-phone="${escapeHtml(conv.phone)}">
        <div class="human-conv-card__header">
          <div class="human-conv-card__identity">
            <span class="human-conv-card__avatar">👤</span>
            <div>
              <strong class="human-conv-card__name">${escapeHtml(conv.name || 'Cliente')}</strong>
              <a href="${waLink}" target="_blank" rel="noopener noreferrer"
                 class="human-conv-card__phone">${phoneDisplay}</a>
            </div>
          </div>
          <div class="human-conv-card__meta">
            <span class="human-conv-card__started">Início: ${startedAt}</span>
            ${duration ? `<span class="human-conv-card__duration">${duration}</span>` : ''}
          </div>
        </div>
        <div class="human-conv-card__messages">
          <p class="human-conv-card__messages-label">Últimas mensagens:</p>
          <div class="human-conv-card__messages-list">${messagesHtml}</div>
        </div>
        <div class="human-conv-card__actions">
          <a href="${waLink}" target="_blank" rel="noopener noreferrer" class="btn-wa">
            📱 Abrir WhatsApp
          </a>
          <button class="btn-end-human btn-danger" data-phone="${escapeHtml(conv.phone)}">
            ✓ Encerrar Conversa
          </button>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.btn-end-human').forEach(btn => {
    btn.addEventListener('click', () => handleEndHuman(btn.dataset.phone));
  });
}

// ── loadHumanConversations ────────────────────────────────────────────────────
async function loadHumanConversations() {
  const list = await DashboardAPI.getHumanConversations();
  renderHumanConversations(list);
}

// ── handleEndHuman ────────────────────────────────────────────────────────────
async function handleEndHuman(phone) {
  const display = formatPhoneDisplay(phone);
  if (!confirm(`Encerrar o atendimento humano de ${display}?\n\nO bot voltará a responder este contato.`)) return;

  const btn = document.querySelector(`.btn-end-human[data-phone="${CSS.escape(phone)}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Encerrando…'; }

  const result = await DashboardAPI.endHumanConversation(phone);

  if (!result || result.error) {
    showToast(result?.error ? `Erro: ${result.error}` : 'Erro ao encerrar atendimento.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = '✓ Encerrar Conversa'; }
  } else {
    showToast('Atendimento encerrado. Bot retomará o atendimento.');
    await loadHumanConversations();
  }
}

// ── Estado ────────────────────────────────────────────────────────────────────
let currentOffset = 0;
const PAGE_LIMIT  = 20;
let   activeFilters = {};
let   allLeadsCache = [];   // cache da página atual para o modal
let   prevCardValues = [];  // para detectar mudanças nos cards

// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDoc(type, doc) {
  if (!doc) return '—';
  if (type === 'cpf')
    return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

function badge(cls, text) {
  return `<span class="tag tag--${cls}">${text}</span>`;
}

function setLoading(show) {
  const tbody = $('leads-tbody');
  if (show) tbody.innerHTML = '<tr><td colspan="7" class="table-loading">⏳ Carregando...</td></tr>';
}

function showUnavailable() {
  $('stats-cards').innerHTML =
    '<div style="grid-column:1/-1;padding:2rem;color:var(--text-muted);text-align:center;">' +
    '⚠️ Dashboard indisponível — banco de dados não configurado.</div>';
  $('leads-tbody').innerHTML =
    '<tr><td colspan="7" class="table-loading">Banco de dados não configurado.</td></tr>';
}

// ── renderCards ───────────────────────────────────────────────────────────────
function renderCards(stats) {
  const s = stats || {};
  const seg = s.por_segmento || {};

  const cards = [
    { icon: '📊', label: 'Total de Leads',    value: s.total        ?? 0, mod: ''          },
    { icon: '✅', label: 'Leads ICP',         value: s.icp          ?? 0, mod: 'success'   },
    { icon: '⚠️', label: 'Fora do ICP',       value: s.fora_icp     ?? 0, mod: 'danger'    },
    { icon: '📅', label: 'Hoje',              value: s.hoje         ?? 0, mod: ''          },
    { icon: '📆', label: 'Últimos 7 dias',    value: s.semana       ?? 0, mod: ''          },
    { icon: '🗓️', label: 'Últimos 30 dias',   value: s.mes          ?? 0, mod: ''          },
    { icon: '⚡', label: 'Venda',             value: seg.venda      ?? 0, mod: ''          },
    { icon: '🔄', label: 'Locação',           value: seg.locacao    ?? 0, mod: 'secondary' },
    { icon: '🔧', label: 'Manutenção',        value: seg.manutencao ?? 0, mod: 'success'   },
  ];

  $('stats-cards').innerHTML = cards.map((c, i) => `
    <div class="card card--${c.mod}" data-idx="${i}">
      <span class="card__icon">${c.icon}</span>
      <div class="card__value">${c.value}</div>
      <div class="card__label">${c.label}</div>
    </div>
  `).join('');

  // Pulsar cards cujo valor mudou desde a última renderização
  if (prevCardValues.length) {
    document.querySelectorAll('#stats-cards .card[data-idx]').forEach(card => {
      const idx = parseInt(card.dataset.idx);
      if (prevCardValues[idx] !== undefined && prevCardValues[idx] !== cards[idx].value) {
        card.classList.add('card--pulse');
        card.addEventListener('animationend', () => card.classList.remove('card--pulse'), { once: true });
      }
    });
  }

  prevCardValues = cards.map(c => c.value);
}

// ── renderLeadsTable ──────────────────────────────────────────────────────────
function renderLeadsTable(leads, total) {
  const tbody = $('leads-tbody');

  if (!leads || !leads.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Nenhum lead encontrado.</td></tr>';
    $('leads-pagination').innerHTML = '';
    return;
  }

  allLeadsCache = leads;

  tbody.innerHTML = leads.map(l => `
    <tr data-id="${l.id}" tabindex="0" role="button" aria-label="Ver detalhes de ${l.name}">
      <td><strong>${l.name}</strong></td>
      <td>${fmtDoc(l.document_type, l.document)}</td>
      <td>${l.email}</td>
      <td>${l.location || '—'}</td>
      <td>${badge(l.segment, SEGMENT_LABELS[l.segment] || l.segment)}</td>
      <td>${l.is_icp ? badge('icp', '✅ ICP') : badge('fora', '⚠️ Fora')}</td>
      <td>${fmtDate(l.created_at)}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('tr[data-id]').forEach(tr => {
    const open = () => {
      const lead = allLeadsCache.find(l => l.id == tr.dataset.id);
      if (lead) openLeadDetail(lead);
    };
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(); });
  });

  renderPagination(total, PAGE_LIMIT, currentOffset);
}

// ── renderPagination ──────────────────────────────────────────────────────────
function renderPagination(total, limit, offset) {
  const container  = $('leads-pagination');
  const totalPages = Math.ceil(total / limit);
  const page       = Math.floor(offset / limit);

  if (totalPages <= 1) { container.innerHTML = ''; return; }

  const start = Math.max(0, page - 2);
  const end   = Math.min(totalPages - 1, page + 2);

  let html = `
    <button class="pagination__btn" data-page="${page - 1}" ${page === 0 ? 'disabled' : ''}>‹ Anterior</button>
  `;
  for (let i = start; i <= end; i++) {
    html += `<button class="pagination__btn ${i === page ? 'pagination__btn--active' : ''}" data-page="${i}">${i + 1}</button>`;
  }
  html += `
    <span class="pagination__info">Página ${page + 1} de ${totalPages} &mdash; ${total} leads</span>
    <button class="pagination__btn" data-page="${page + 1}" ${page >= totalPages - 1 ? 'disabled' : ''}>Próxima ›</button>
  `;

  container.innerHTML = html;
  container.querySelectorAll('[data-page]:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      currentOffset = parseInt(btn.dataset.page) * PAGE_LIMIT;
      loadLeads();
    });
  });
}

// ── openLeadDetail ────────────────────────────────────────────────────────────
function openLeadDetail(lead) {
  const detailRow = (label, value) => `
    <div class="detail-row">
      <span class="detail-label">${label}</span>
      <span class="detail-value">${value ?? '—'}</span>
    </div>
  `;

  let qualificacao = '';
  if (lead.segment === 'venda' && lead.kva_range) {
    qualificacao = detailRow('Faixa de kVA', KVA_LABELS[lead.kva_range] || lead.kva_range);
  } else if (lead.segment === 'locacao' && lead.contract_type) {
    qualificacao = detailRow('Tipo de contrato', CONTRACT_LABELS[lead.contract_type] || lead.contract_type);
  } else if (lead.segment === 'manutencao') {
    qualificacao  = detailRow('Marca do equipamento', lead.equipment_brand);
    qualificacao += detailRow('Modelo do equipamento', lead.equipment_model);
  }

  $('modal-body').innerHTML = `
    <p class="detail-section-title">Dados Pessoais</p>
    ${detailRow('Nome',     lead.name)}
    ${detailRow('Documento', fmtDoc(lead.document_type, lead.document))}
    ${detailRow('Empresa',  lead.company_name)}
    ${detailRow('E-mail',   lead.email)}
    ${detailRow('Telefone', lead.phone)}
    ${detailRow('📍 Localização', lead.location || '—')}

    <p class="detail-section-title">Qualificação</p>
    ${detailRow('Segmento', SEGMENT_LABELS[lead.segment] || lead.segment)}
    ${qualificacao}
    ${detailRow('ICP', lead.is_icp ? '✅ Qualificado' : '⚠️ Fora do ICP')}
    ${detailRow('Newsletter', lead.opt_in_newsletter === true ? 'Sim' : lead.opt_in_newsletter === false ? 'Não' : '—')}

    <p class="detail-section-title">Meta</p>
    ${detailRow('Tags', (lead.tags || []).join(', '))}
    ${detailRow('Data de criação', fmtDate(lead.created_at))}
    ${detailRow('ID', lead.id)}
  `;

  const modal = $('lead-detail-modal');
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  const modal = $('lead-detail-modal');
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
}

// ── applyFilters ──────────────────────────────────────────────────────────────
function applyFilters() {
  activeFilters = {};
  const seg      = $('filter-segment').value;
  const icp      = $('filter-icp').value;
  const dateFrom = $('filter-date-from').value;
  const dateTo   = $('filter-date-to').value;

  if (seg)      activeFilters.segment   = seg;
  if (icp)      activeFilters.is_icp    = icp;
  if (dateFrom) activeFilters.date_from = dateFrom;
  if (dateTo)   activeFilters.date_to   = dateTo;

  currentOffset = 0;
  loadLeads();
}

// ── Loaders ───────────────────────────────────────────────────────────────────
async function loadLeads() {
  setLoading(true);
  const params = { limit: PAGE_LIMIT, offset: currentOffset, ...activeFilters };
  const result = await DashboardAPI.getLeads(params);
  renderLeadsTable(result.leads, result.total);
}

async function loadCharts(dias = 30) {
  const [leadsDia, segmentos, funil, localizacoes] = await Promise.all([
    DashboardAPI.getLeadsPorDia(dias),
    DashboardAPI.getSegmentos(),
    DashboardAPI.getFunil(),
    DashboardAPI.getLocalizacoes(),
  ]);
  DashboardCharts.renderLeadsPorDia('chart-leads-dia', leadsDia);
  DashboardCharts.renderSegmentos('chart-segmentos', segmentos);
  DashboardCharts.renderLocalizacaoChart('chart-localizacoes', localizacoes);
  DashboardCharts.renderFunil('chart-funil', funil);
}

async function checkHealth() {
  const h = await DashboardAPI.getHealth();
  const badge  = $('db-status');
  const banner = $('alert-banner');
  const sessionsEl = $('sessions-value');

  if (h.database === 'connected') {
    badge.textContent = 'Conectado';
    badge.className = 'badge badge--ok';
    if (banner) banner.hidden = true;
  } else if (h.database === 'not_configured') {
    badge.textContent = 'Não configurado';
    badge.className = 'badge badge--loading';
    if (banner) banner.hidden = true;
  } else {
    badge.textContent = 'Desconectado';
    badge.className = 'badge badge--error';
    if (banner) banner.hidden = false;
  }

  if (sessionsEl && h.sessions !== undefined) {
    sessionsEl.textContent = h.sessions;
  }

  return h.database;
}

// ── refreshBackground ─────────────────────────────────────────────────────────
// Atualiza stats e gráficos sem recarregar a tabela (preserva filtros/paginação)
async function refreshBackground() {
  const dias = parseInt($('select-dias').value) || 30;
  const [stats] = await Promise.all([
    DashboardAPI.getStats(),
    loadCharts(dias),
  ]);
  renderCards(stats);
  $('last-update').textContent = 'Atualizado: ' + new Date().toLocaleTimeString('pt-BR');
}

// ── init ──────────────────────────────────────────────────────────────────────
async function init() {
  setLoading(true);

  const dbStatus = await checkHealth();
  if (dbStatus !== 'connected') {
    showUnavailable();
    return;
  }

  const dias = parseInt($('select-dias').value) || 30;

  const [stats] = await Promise.all([
    DashboardAPI.getStats(),
    loadCharts(dias),
    loadLeads(),
  ]);

  renderCards(stats);
  $('last-update').textContent = 'Atualizado: ' + new Date().toLocaleTimeString('pt-BR');
}

// ── Event Listeners ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Redireciona para login se não autenticado (guard secundário — o primário
  // está no script inline do index.html, antes do body ser renderizado)
  if (typeof Auth !== 'undefined' && !Auth.isAuthenticated()) {
    window.location.href = '/login';
    return;
  }

  // Exibe e-mail do usuário autenticado no header
  try {
    const _user = JSON.parse(localStorage.getItem('auth_user') || '{}');
    const emailEl = document.getElementById('user-email');
    if (emailEl && _user.email) emailEl.textContent = _user.email;
  } catch (_) {}

  init();

  $('btn-refresh').addEventListener('click', async () => {
    const btn = $('btn-refresh');
    btn.classList.add('is-spinning');
    currentOffset = 0;
    await init();
    btn.classList.remove('is-spinning');
  });

  $('select-dias').addEventListener('change', e => {
    loadCharts(parseInt(e.target.value));
  });

  $('btn-filter').addEventListener('click', applyFilters);

  $('btn-export-csv').addEventListener('click', () => {
    const params = new URLSearchParams();
    if (activeFilters.segment)   params.append('segment',   activeFilters.segment);
    if (activeFilters.is_icp !== undefined) params.append('is_icp', activeFilters.is_icp);
    if (activeFilters.date_from) params.append('date_from', activeFilters.date_from);
    if (activeFilters.date_to)   params.append('date_to',   activeFilters.date_to);
    const qs = params.toString();
    window.open(`/api/leads/export/csv${qs ? '?' + qs : ''}`, '_blank');
  });

  // Permite filtrar pressionando Enter nos inputs de data
  [$('filter-date-from'), $('filter-date-to')].forEach(el => {
    el?.addEventListener('keydown', e => { if (e.key === 'Enter') applyFilters(); });
  });

  $('modal-close').addEventListener('click', closeModal);
  $('modal-backdrop').addEventListener('click', closeModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // Logout
  const btnLogout = $('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      btnLogout.disabled = true;
      if (typeof Auth !== 'undefined') await Auth.logout();
    });
  }

  // Botão de refresh da aba de conversas humanas
  const btnRefreshHumanas = $('btn-refresh-humanas');
  if (btnRefreshHumanas) {
    btnRefreshHumanas.addEventListener('click', async () => {
      btnRefreshHumanas.classList.add('is-spinning');
      await loadHumanConversations();
      btnRefreshHumanas.classList.remove('is-spinning');
    });
  }

  // Verifica status do banco a cada 30 segundos
  setInterval(checkHealth, 30_000);

  // Atualiza stats e gráficos a cada 60 segundos (sem recarregar tabela)
  setInterval(refreshBackground, 60_000);

  // Auto-refresh de conversas humanas a cada 5 segundos (só quando a aba está ativa)
  setInterval(() => {
    if (!$('tab-humanas')?.hidden) loadHumanConversations();
  }, 5_000);
});
