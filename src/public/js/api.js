const DashboardAPI = {
  async _get(url) {
    try {
      const res = await fetch(url);
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
};
