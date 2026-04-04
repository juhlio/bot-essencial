const CHART_DEFAULTS = {
  color: { grid: 'rgba(255,255,255,.06)', text: '#9ca3af' },
  colors: {
    primary:    'rgba(245,166,35,.85)',
    primaryFill:'rgba(245,166,35,.15)',
    success:    'rgba(34,197,94,.85)',
    successFill:'rgba(34,197,94,.15)',
    danger:     'rgba(239,68,68,.85)',
    venda:      'rgba(99,102,241,.85)',
    locacao:    'rgba(245,166,35,.85)',
    manutencao: 'rgba(20,184,166,.85)',
  },
};

Chart.defaults.color          = CHART_DEFAULTS.color.text;
Chart.defaults.borderColor    = CHART_DEFAULTS.color.grid;
Chart.defaults.font.family    = "'Segoe UI', system-ui, sans-serif";

const Charts = {
  _instances: {},

  _destroy(id) {
    if (this._instances[id]) {
      this._instances[id].destroy();
      delete this._instances[id];
    }
  },

  renderLeadsPorDia(data) {
    this._destroy('leads-dia');
    const ctx = document.getElementById('chart-leads-dia').getContext('2d');
    this._instances['leads-dia'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map(d => d.date.slice(5)),
        datasets: [
          {
            label: 'Total',
            data: data.map(d => d.total),
            borderColor: CHART_DEFAULTS.colors.primary,
            backgroundColor: CHART_DEFAULTS.colors.primaryFill,
            fill: true,
            tension: 0.3,
            pointRadius: 3,
          },
          {
            label: 'ICP',
            data: data.map(d => d.icp),
            borderColor: CHART_DEFAULTS.colors.success,
            backgroundColor: 'transparent',
            tension: 0.3,
            pointRadius: 2,
            borderDash: [4, 3],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { position: 'top', labels: { boxWidth: 12 } } },
        scales: {
          x: { grid: { color: CHART_DEFAULTS.color.grid }, ticks: { maxTicksLimit: 10 } },
          y: { grid: { color: CHART_DEFAULTS.color.grid }, beginAtZero: true, ticks: { stepSize: 1 } },
        },
      },
    });
  },

  renderSegmentos(segmentos) {
    this._destroy('segmentos');
    const labels = ['Venda', 'Locação', 'Manutenção'];
    const venda     = Object.values(segmentos.venda     || {}).reduce((a, b) => a + b, 0);
    const locacao   = Object.values(segmentos.locacao   || {}).reduce((a, b) => a + b, 0);
    const manutencao = (segmentos.manutencao || {}).total || 0;

    const ctx = document.getElementById('chart-segmentos').getContext('2d');
    this._instances['segmentos'] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: [venda, locacao, manutencao],
          backgroundColor: [
            CHART_DEFAULTS.colors.venda,
            CHART_DEFAULTS.colors.locacao,
            CHART_DEFAULTS.colors.manutencao,
          ],
          borderWidth: 2,
          borderColor: '#1a1d27',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
        },
        cutout: '65%',
      },
    });
  },

  renderFunil(funil) {
    this._destroy('funil');
    const ctx = document.getElementById('chart-funil').getContext('2d');
    this._instances['funil'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Sessões', 'Concluídas', 'ICP', 'Fora ICP'],
        datasets: [{
          data: [
            funil.sessoes_iniciadas,
            funil.sessoes_completadas,
            funil.leads_icp,
            funil.leads_fora_icp,
          ],
          backgroundColor: [
            CHART_DEFAULTS.colors.primary,
            CHART_DEFAULTS.colors.success,
            CHART_DEFAULTS.colors.venda,
            CHART_DEFAULTS.colors.danger,
          ],
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: CHART_DEFAULTS.color.grid }, beginAtZero: true, ticks: { stepSize: 1 } },
        },
      },
    });
  },
};
