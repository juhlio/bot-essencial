const KVA_LABELS      = { 1:'Até 50 kVA', 2:'50–100 kVA', 3:'100–200 kVA', 4:'200–300 kVA', 5:'> 300 kVA', 6:'A dimensionar' };
const CONTRACT_LABELS = { 1:'Stand-by', 2:'Prime/Contínua', 3:'Longo Prazo', 4:'Sob Demanda' };
const SEGMENT_LABELS  = { venda:'Venda', locacao:'Locação', manutencao:'Manutenção' };

let currentPage   = 0;
const PAGE_SIZE   = 20;
let activeFilters = {};

// ── Utilitários ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' });
}

function tag(cls, text) {
  return `<span class="tag tag--${cls}">${text}</span>`;
}

// ── Render Stats Cards ─────────────────────────────────────────────────────────
function renderStats(s) {
  const cards = [
    { label: 'Total de Leads',   value: s.total,       sub: 'desde o início',      mod: 'primary' },
    { label: 'Leads ICP',        value: s.icp,         sub: 'qualificados',         mod: 'success' },
    { label: 'Fora do ICP',      value: s.fora_icp,    sub: '< 50 kVA',             mod: 'danger'  },
    { label: 'Hoje',             value: s.hoje,        sub: 'nas últimas 24h',      mod: ''        },
    { label: 'Últimos 7 dias',   value: s.semana,      sub: '',                     mod: ''        },
    { label: 'Últimos 30 dias',  value: s.mes,         sub: '',                     mod: ''        },
  ];
  $('stats-cards').innerHTML = cards.map(c => `
    <div class="card card--${c.mod}">
      <div class="card__label">${c.label}</div>
      <div class="card__value">${c.value}</div>
      ${c.sub ? `<div class="card__sub">${c.sub}</div>` : ''}
    </div>
  `).join('');
}

// ── Render Leads Table ─────────────────────────────────────────────────────────
function renderTable(leads) {
  const tbody = $('leads-tbody');
  if (!leads.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="table-loading">Nenhum lead encontrado.</td></tr>';
    return;
  }
  tbody.innerHTML = leads.map(l => `
    <tr data-id="${l.id}">
      <td>${l.id}</td>
      <td>${l.name}</td>
      <td>${l.company_name || '—'}</td>
      <td>${tag(l.segment, SEGMENT_LABELS[l.segment] || l.segment)}</td>
      <td>${l.is_icp ? tag('icp', 'ICP') : tag('fora', 'Fora')}</td>
      <td>${l.email}</td>
      <td>${l.phone}</td>
      <td>${fmtDate(l.created_at)}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('tr[data-id]').forEach(tr =>
    tr.addEventListener('click', () => openModal(leads.find(l => l.id == tr.dataset.id)))
  );
}

function renderPagination(total, offset, limit) {
  const totalPages = Math.ceil(total / limit);
  const page       = Math.floor(offset / limit);
  const container  = $('leads-pagination');

  if (totalPages <= 1) { container.innerHTML = ''; return; }

  let html = `<button class="pagination__btn" ${page === 0 ? 'disabled' : ''} data-page="${page - 1}">‹ Anterior</button>`;
  const start = Math.max(0, page - 2);
  const end   = Math.min(totalPages - 1, page + 2);
  for (let i = start; i <= end; i++) {
    html += `<button class="pagination__btn ${i === page ? 'pagination__btn--active' : ''}" data-page="${i}">${i + 1}</button>`;
  }
  html += `<button class="pagination__btn" ${page >= totalPages - 1 ? 'disabled' : ''} data-page="${page + 1}">Próxima ›</button>`;
  container.innerHTML = html;

  container.querySelectorAll('[data-page]').forEach(btn =>
    btn.addEventListener('click', () => {
      currentPage = parseInt(btn.dataset.page);
      loadLeads();
    })
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────────
function openModal(lead) {
  if (!lead) return;
  const modal = $('lead-detail-modal');
  const rows = [
    ['Nome',        lead.name],
    ['Empresa',     lead.company_name || '—'],
    ['Documento',   `${(lead.document_type || '').toUpperCase()}: ${lead.document}`],
    ['E-mail',      lead.email],
    ['Telefone',    lead.phone],
    ['Segmento',    SEGMENT_LABELS[lead.segment] || lead.segment],
    ['ICP',         lead.is_icp ? '✅ Qualificado' : '❌ Fora do ICP'],
    ['Newsletter',  lead.opt_in_newsletter === true ? 'Sim' : lead.opt_in_newsletter === false ? 'Não' : '—'],
    ['Tags',        (lead.tags || []).join(', ')],
    ['Data',        new Date(lead.created_at).toLocaleString('pt-BR')],
  ];

  if (lead.segment === 'venda' && lead.kva_range) {
    rows.push(['Faixa kVA', KVA_LABELS[lead.kva_range] || lead.kva_range]);
  }
  if (lead.segment === 'locacao' && lead.contract_type) {
    rows.push(['Tipo contrato', CONTRACT_LABELS[lead.contract_type] || lead.contract_type]);
  }
  if (lead.segment === 'manutencao') {
    if (lead.equipment_brand) rows.push(['Marca', lead.equipment_brand]);
    if (lead.equipment_model) rows.push(['Modelo', lead.equipment_model]);
  }

  $('modal-body').innerHTML = rows.map(([l, v]) => `
    <div class="detail-row">
      <span class="detail-label">${l}</span>
      <span class="detail-value">${v}</span>
    </div>
  `).join('');

  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  const modal = $('lead-detail-modal');
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
}

// ── Loaders ────────────────────────────────────────────────────────────────────
async function loadStats() {
  const stats = await DashboardAPI.getStats();
  renderStats(stats);
}

async function loadCharts(dias = 30) {
  const [leadsDia, segmentos, funil] = await Promise.all([
    DashboardAPI.getLeadsPorDia(dias),
    DashboardAPI.getSegmentos(),
    DashboardAPI.getFunil(),
  ]);
  Charts.renderLeadsPorDia(leadsDia);
  Charts.renderSegmentos(segmentos);
  Charts.renderFunil(funil);
}

async function loadLeads() {
  $('leads-tbody').innerHTML = '<tr><td colspan="8" class="table-loading">Carregando...</td></tr>';
  const params = {
    limit: PAGE_SIZE,
    offset: currentPage * PAGE_SIZE,
    ...activeFilters,
  };
  const { leads, total } = await DashboardAPI.getLeads(params);
  renderTable(leads);
  renderPagination(total, currentPage * PAGE_SIZE, PAGE_SIZE);
}

async function checkHealth() {
  try {
    const h = await DashboardAPI.getHealth();
    const badge = $('db-status');
    if (h.database === 'connected') {
      badge.textContent = 'DB conectado';
      badge.className = 'badge badge--ok';
    } else if (h.database === 'not_configured') {
      badge.textContent = 'Sem banco';
      badge.className = 'badge badge--error';
    } else {
      badge.textContent = 'DB erro';
      badge.className = 'badge badge--error';
    }
  } catch {
    $('db-status').textContent = 'Offline';
    $('db-status').className = 'badge badge--error';
  }
}

async function loadAll(dias = 30) {
  await Promise.all([loadStats(), loadCharts(dias), loadLeads(), checkHealth()]);
  $('last-update').textContent = 'Atualizado: ' + new Date().toLocaleTimeString('pt-BR');
}

// ── Event listeners ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadAll();

  $('btn-refresh').addEventListener('click', () => loadAll(parseInt($('select-dias').value)));

  $('select-dias').addEventListener('change', e => {
    loadCharts(parseInt(e.target.value));
  });

  $('btn-filter').addEventListener('click', () => {
    activeFilters.segment   = $('filter-segment').value || undefined;
    activeFilters.is_icp    = $('filter-icp').value    || undefined;
    activeFilters.date_from = $('filter-date-from').value || undefined;
    activeFilters.date_to   = $('filter-date-to').value   || undefined;
    currentPage = 0;
    loadLeads();
  });

  $('modal-close').addEventListener('click', closeModal);
  $('modal-backdrop').addEventListener('click', closeModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // Auto-refresh a cada 60 segundos
  setInterval(() => loadAll(parseInt($('select-dias').value)), 60_000);
});
