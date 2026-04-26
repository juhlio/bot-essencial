// ── Valores de exemplo para preview de variáveis ──────────────────────────────
const VAR_EXAMPLES = {
  name:    'João Silva',
  company: 'Empresa Exemplo Ltda',
  team:    'comercial',
};

// ── Formatação WhatsApp → HTML ─────────────────────────────────────────────────
function waToHtml(text) {
  return text
    .replace(/\*(.*?)\*/g,   '<strong>$1</strong>')
    .replace(/_(.*?)_/g,     '<em>$1</em>')
    .replace(/~(.*?)~/g,     '<s>$1</s>')
    .replace(/\n/g,          '<br>');
}

// ── Substitui variáveis no texto com valores de exemplo ───────────────────────
function fillVarsPreview(text) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, v) => VAR_EXAMPLES[v] || `{{${v}}}`);
}

// ── Toast ──────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast--visible'));
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 3500);
}

// ── Renderiza preview no painel direito ───────────────────────────────────────
function updatePreview(cardEl, content) {
  const bubble = cardEl.querySelector('.wa-bubble');
  if (bubble) bubble.innerHTML = waToHtml(fillVarsPreview(content));
}

// ── Marca card como dirty (não salvo) ─────────────────────────────────────────
function setDirty(cardEl, dirty) {
  cardEl.classList.toggle('message-card--dirty', dirty);
  const indicator = cardEl.querySelector('.dirty-indicator');
  if (indicator) indicator.hidden = !dirty;
}

// ── Renderiza um card de mensagem ─────────────────────────────────────────────
function renderMessageCard(template) {
  const card = document.createElement('div');
  card.className = 'message-card';
  card.dataset.key = template.key;

  const isFallback = template.source === 'fallback';
  const updatedAt = template.updated_at
    ? new Date(template.updated_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : '—';

  const varChips = (template.variables || []).map(v =>
    `<button class="var-chip" data-var="${v}" title="Clique para inserir no cursor">{{${v}}}</button>`
  ).join('');

  const varsLine = template.variables && template.variables.length
    ? `<div class="message-card__variables">Variáveis: ${varChips}</div>`
    : `<div class="message-card__variables" style="color:var(--text-muted);font-size:0.75rem;">Sem variáveis</div>`;

  card.innerHTML = `
    <div class="message-card__head">
      <div>
        <span class="message-card__label">📝 ${template.label}</span>
        <span class="message-card__key">[${template.key}]</span>
        <span class="dirty-indicator" hidden title="Alterações não salvas">●</span>
      </div>
      ${template.description ? `<p class="message-card__desc">${template.description}</p>` : ''}
    </div>
    <div class="message-card__body">
      <div class="message-card__editor-wrap">
        <textarea class="message-card__editor" rows="8" spellcheck="false"
          ${isFallback ? 'disabled title="Banco indisponível — edição desabilitada"' : ''}
        >${template.content}</textarea>
      </div>
      <div class="message-card__preview-wrap">
        <div class="message-card__preview-label">Preview WhatsApp</div>
        <div class="wa-preview">
          <div class="wa-bubble">${waToHtml(fillVarsPreview(template.content))}</div>
        </div>
      </div>
    </div>
    ${varsLine}
    <div class="message-card__meta">
      Última edição: <strong>${template.updated_by || 'system'}</strong> — ${updatedAt}
      ${isFallback ? ' <span class="badge badge--loading" style="font-size:0.62rem">fallback</span>' : ''}
    </div>
    <div class="message-card__actions">
      <button class="btn-save btn-filter" ${isFallback ? 'disabled' : ''}>💾 Salvar</button>
      <button class="btn-reset-one" style="background:none;border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);padding:0.35rem 0.9rem;font-size:0.75rem;font-weight:600;cursor:pointer;" ${isFallback ? 'disabled' : ''}>↩️ Restaurar Original</button>
    </div>
  `;

  const textarea = card.querySelector('.message-card__editor');
  let debounceTimer;

  // Preview em tempo real com debounce 300ms
  textarea.addEventListener('input', () => {
    setDirty(card, true);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => updatePreview(card, textarea.value), 300);
  });

  // Inserção de variável no cursor
  card.querySelectorAll('.var-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (textarea.disabled) return;
      const varText = `{{${chip.dataset.var}}}`;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value = textarea.value.slice(0, start) + varText + textarea.value.slice(end);
      textarea.selectionStart = textarea.selectionEnd = start + varText.length;
      textarea.focus();
      textarea.dispatchEvent(new Event('input'));
    });
  });

  // Salvar
  card.querySelector('.btn-save').addEventListener('click', async () => {
    const btn = card.querySelector('.btn-save');
    const content = textarea.value.trim();
    if (!content) { showToast('Conteúdo não pode ser vazio.', 'error'); return; }
    btn.disabled = true;
    btn.textContent = 'Salvando…';
    const result = await DashboardAPI.updateMessage(template.key, content);
    btn.disabled = false;
    btn.textContent = '💾 Salvar';
    if (result.error) {
      showToast(`Erro: ${result.error}`, 'error');
    } else {
      setDirty(card, false);
      showToast(`"${template.label}" salvo com sucesso.`);
    }
  });

  // Restaurar individual
  card.querySelector('.btn-reset-one').addEventListener('click', async () => {
    if (!confirm(`Restaurar "${template.label}" para o texto original?\nAs edições serão perdidas.`)) return;
    const result = await DashboardAPI.resetMessage(template.key);
    if (result.error) {
      showToast(`Erro: ${result.error}`, 'error');
    } else {
      textarea.value = result.content;
      updatePreview(card, result.content);
      setDirty(card, false);
      showToast(`"${template.label}" restaurado.`);
    }
  });

  return card;
}

// ── Renderiza accordion de categorias ─────────────────────────────────────────
function renderMessagesAccordion(data) {
  const container = document.getElementById('messages-list');
  container.innerHTML = '';

  if (!data.categories || !data.categories.length) {
    container.innerHTML = '<p style="padding:2rem;color:var(--text-muted);text-align:center;">Nenhum template encontrado.</p>';
    return;
  }

  for (const cat of data.categories) {
    const section = document.createElement('div');
    section.className = 'message-category';

    const header = document.createElement('button');
    header.className = 'message-category__header';
    header.innerHTML = `<span>${cat.label}</span><span class="cat-count">${cat.messages.length}</span><span class="cat-chevron">▾</span>`;
    section.appendChild(header);

    const body = document.createElement('div');
    body.className = 'message-category__body';
    for (const msg of cat.messages) {
      body.appendChild(renderMessageCard(msg));
    }
    section.appendChild(body);

    // Toggle accordion
    header.addEventListener('click', () => {
      const open = !body.hidden;
      body.hidden = open;
      header.classList.toggle('message-category__header--closed', open);
    });

    container.appendChild(section);
  }
}

// ── Carrega e inicializa a aba de mensagens ───────────────────────────────────
async function loadMessages() {
  const container = document.getElementById('messages-list');
  container.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);">⏳ Carregando...</div>';
  const data = await DashboardAPI.getMessages();
  renderMessagesAccordion(data);
}

// ── Inicialização do módulo ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Navegação por abas
  const tabBtns = document.querySelectorAll('.tab-btn');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;

      document.querySelectorAll('[id^="tab-"]').forEach(el => { el.hidden = true; });
      const selected = document.getElementById(`tab-${tab}`);
      if (selected) selected.hidden = false;

      if (tab === 'mensagens' && document.getElementById('messages-list').children.length <= 1) {
        loadMessages();
      }
      if (tab === 'humanas' && typeof loadHumanConversations === 'function') {
        loadHumanConversations();
      }
    });
  });

  // Restaurar todos
  document.getElementById('btn-reset-all').addEventListener('click', async () => {
    if (!confirm('Restaurar TODAS as mensagens para o texto original?\nTodas as edições serão perdidas.')) return;
    const result = await DashboardAPI.resetAllMessages();
    if (result.error) {
      showToast(`Erro: ${result.error}`, 'error');
    } else {
      showToast(`${result.reset} mensagens restauradas.`);
      await loadMessages();
    }
  });
});
