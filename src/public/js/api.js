const API = {
  async _get(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  getStats()            { return this._get('/api/dashboard/stats'); },
  getLeadsPorDia(dias)  { return this._get(`/api/dashboard/leads-por-dia?dias=${dias}`); },
  getFunil()            { return this._get('/api/dashboard/funil'); },
  getSegmentos()        { return this._get('/api/dashboard/segmentos'); },
  getLeads(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this._get(`/api/leads${qs ? '?' + qs : ''}`);
  },
  getHealth()           { return this._get('/health'); },
};
