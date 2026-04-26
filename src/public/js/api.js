const DashboardAPI = {
  // Retorna os cabeçalhos de autorização se Auth estiver disponível
  _authHeaders() {
    return (typeof Auth !== 'undefined') ? Auth.getAuthHeader() : {};
  },

  // Redireciona para login em caso de 401
  _handle401() {
    if (typeof Auth !== 'undefined') Auth.logout();
  },

  async _get(url) {
    try {
      const res = await fetch(url, { headers: this._authHeaders() });
      if (res.status === 401) { this._handle401(); return null; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } catch (err) {
      console.error(`[DashboardAPI] GET ${url} falhou:`, err.message);
      return null;
    }
  },

  async getStats() {
    return await this._get('/api/dashboard/stats') ?? {};
  },

  async getLeadsPorDia(dias = 30) {
    return await this._get(`/api/dashboard/leads-por-dia?dias=${dias}`) ?? [];
  },

  async getFunil() {
    return await this._get('/api/dashboard/funil') ?? {};
  },

  async getSegmentos() {
    return await this._get('/api/dashboard/segmentos') ?? {};
  },

  async getLeads(filters = {}) {
    const params = new URLSearchParams();
    const allowed = ['segment', 'is_icp', 'date_from', 'date_to', 'limit', 'offset'];
    for (const key of allowed) {
      if (filters[key] !== undefined && filters[key] !== '') {
        params.append(key, filters[key]);
      }
    }
    const qs = params.toString();
    return await this._get(`/api/leads${qs ? '?' + qs : ''}`) ?? { total: 0, leads: [] };
  },

  async getLeadById(id) {
    return await this._get(`/api/leads/${id}`) ?? null;
  },

  async getHealth() {
    return await this._get('/health') ?? {};
  },

  async getMessages() {
    return await this._get('/api/messages') ?? { categories: [] };
  },

  async getMessage(key) {
    return await this._get(`/api/messages/${key}`) ?? null;
  },

  async updateMessage(key, content, updatedBy = 'dashboard') {
    try {
      const res = await fetch(`/api/messages/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
        body: JSON.stringify({ content, updated_by: updatedBy }),
      });
      if (!res.ok) {
        const err = await res.json();
        return { error: err.error || `HTTP ${res.status}` };
      }
      return await res.json();
    } catch (err) {
      return { error: err.message };
    }
  },

  async resetMessage(key) {
    try {
      const res = await fetch('/api/messages/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
        body: JSON.stringify({ key }),
      });
      return await res.json();
    } catch (err) {
      return { error: err.message };
    }
  },

  async resetAllMessages() {
    try {
      const res = await fetch('/api/messages/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
        body: JSON.stringify({}),
      });
      return await res.json();
    } catch (err) {
      return { error: err.message };
    }
  },

  async getHumanConversations(limit = 50) {
    return await this._get(`/api/conversations/human-active?limit=${limit}`) ?? { total: 0, conversations: [] };
  },

  async endHumanConversation(from) {
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(from)}/end-human`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
        body: JSON.stringify({}),
      });
      if (res.status === 401) { this._handle401(); return null; }
      return await res.json();
    } catch (err) {
      return { error: err.message };
    }
  },

  async getLocalizacoes() {
    return await this._get('/api/dashboard/localizacoes') ?? [];
  },

  async previewMessage(content, variables) {
    try {
      const res = await fetch('/api/messages/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
        body: JSON.stringify({ content, variables }),
      });
      return await res.json();
    } catch (err) {
      return { error: err.message };
    }
  },
};
