Chart.defaults.font.family    = 'Arial, sans-serif';
Chart.defaults.animation      = { duration: 500 };
Chart.defaults.plugins.tooltip.padding = 10;

const COLORS = {
  primary:    '#1B3A5C',
  primaryAlpha:'rgba(27,58,92,.75)',
  secondary:  '#E8671C',
  secondaryAlpha:'rgba(232,103,28,.75)',
  success:    '#27AE60',
  successAlpha:'rgba(39,174,96,.75)',
  grid:       '#e8ecf0',
  text:       '#7F8C8D',
};

const DashboardCharts = {
  _instances: {},

  _destroy(id) {
    if (this._instances[id]) {
      this._instances[id].destroy();
      delete this._instances[id];
    }
  },

  _canvas(canvasId) {
    const el = document.getElementById(canvasId);
    if (!el) { console.warn(`[DashboardCharts] canvas #${canvasId} não encontrado`); return null; }
    return el.getContext('2d');
  },

  // ── 1. Leads por dia (barras empilhadas) ───────────────────────────────────
  renderLeadsPorDia(canvasId, data) {
    const ctx = this._canvas(canvasId);
    if (!ctx || !data?.length) return;
    this._destroy(canvasId);

    const fmtLabel = iso => {
      const [, m, d] = iso.split('-');
      return `${d}/${m}`;
    };
    const fmtFull = iso => {
      const [y, m, d] = iso.split('-');
      return `${d}/${m}/${y}`;
    };

    this._instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.map(d => fmtLabel(d.date)),
        datasets: [
          {
            label: 'ICP',
            data: data.map(d => d.icp),
            backgroundColor: COLORS.primaryAlpha,
            borderColor: COLORS.primary,
            borderWidth: 1,
            stack: 'leads',
          },
          {
            label: 'Fora do ICP',
            data: data.map(d => d.fora_icp),
            backgroundColor: COLORS.secondaryAlpha,
            borderColor: COLORS.secondary,
            borderWidth: 1,
            stack: 'leads',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, padding: 16 } },
          tooltip: {
            callbacks: {
              title: items => fmtFull(data[items[0].dataIndex].date),
              footer: items => {
                const total = data[items[0].dataIndex].total;
                return `Total: ${total}`;
              },
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { color: COLORS.grid },
            ticks: { color: COLORS.text, maxTicksLimit: 15 },
          },
          y: {
            stacked: true,
            grid: { color: COLORS.grid },
            ticks: { color: COLORS.text, stepSize: 1, precision: 0 },
            beginAtZero: true,
          },
        },
      },
    });
  },

  // ── 2. Segmentos (donut com label central) ─────────────────────────────────
  renderSegmentos(canvasId, data) {
    const ctx = this._canvas(canvasId);
    if (!ctx || !data) return;
    this._destroy(canvasId);

    const venda      = Object.values(data.venda      || {}).reduce((a, b) => a + b, 0);
    const locacao    = Object.values(data.locacao    || {}).reduce((a, b) => a + b, 0);
    const manutencao = (data.manutencao || {}).total || 0;
    const total      = venda + locacao + manutencao;

    // Plugin inline para label central
    const centerLabel = {
      id: `center-${canvasId}`,
      beforeDraw(chart) {
        const { width, height, ctx: c } = chart;
        c.save();
        c.font = `bold ${Math.round(height / 8)}px Arial, sans-serif`;
        c.fillStyle = COLORS.primary;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(total, width / 2, height / 2 - 8);
        c.font = `${Math.round(height / 14)}px Arial, sans-serif`;
        c.fillStyle = COLORS.text;
        c.fillText('leads', width / 2, height / 2 + 14);
        c.restore();
      },
    };

    this._instances[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Venda', 'Locação', 'Manutenção'],
        datasets: [{
          data: [venda, locacao, manutencao],
          backgroundColor: [COLORS.primaryAlpha, COLORS.secondaryAlpha, COLORS.successAlpha],
          borderColor:      [COLORS.primary,      COLORS.secondary,      COLORS.success],
          borderWidth: 2,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '62%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 12, padding: 14 },
          },
          tooltip: {
            callbacks: {
              label: item => {
                const val = item.raw;
                const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                return ` ${item.label}: ${val} (${pct}%)`;
              },
            },
          },
        },
      },
      plugins: [centerLabel],
    });
  },

  // ── 4. Localização (top 10 barras horizontais) ────────────────────────────
  renderLocalizacaoChart(canvasId, data) {
    const ctx = this._canvas(canvasId);
    if (!ctx || !data?.length) return;
    this._destroy(canvasId);

    const sorted = [...data]
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const labels = sorted.map(d => d.location || 'Não informado');
    const counts = sorted.map(d => d.count);

    this._instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Leads por Localização',
          data: counts,
          backgroundColor: COLORS.primaryAlpha,
          borderColor: COLORS.primary,
          borderWidth: 1,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.parsed.x} leads`,
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: COLORS.grid },
            ticks: { color: COLORS.text, precision: 0 },
          },
          y: {
            grid: { display: false },
            ticks: { color: COLORS.text },
          },
        },
      },
    });
  },

  // ── 3. Funil (barras horizontais) ─────────────────────────────────────────
  renderFunil(canvasId, data) {
    const ctx = this._canvas(canvasId);
    if (!ctx || !data) return;
    this._destroy(canvasId);

    const { sessoes_iniciadas = 0, sessoes_completadas = 0, leads_icp = 0, leads_fora_icp = 0, taxa_conclusao = 0, taxa_icp = 0 } = data;
    const total_leads = leads_icp + leads_fora_icp;

    const labels = [
      'Sessões Iniciadas',
      `Sessões Completadas (${taxa_conclusao}%)`,
      `Leads ICP (${taxa_icp}%)`,
      `Leads Fora do ICP (${total_leads > 0 ? Math.round((leads_fora_icp / total_leads) * 100) : 0}%)`,
    ];
    const values = [sessoes_iniciadas, sessoes_completadas, leads_icp, leads_fora_icp];
    const bgColors = [
      COLORS.primaryAlpha,
      'rgba(27,80,140,.75)',
      COLORS.successAlpha,
      COLORS.secondaryAlpha,
    ];
    const borderColors = [COLORS.primary, '#1b508c', COLORS.success, COLORS.secondary];

    this._instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: bgColors,
          borderColor: borderColors,
          borderWidth: 1,
          borderRadius: 4,
          barThickness: 28,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: item => ` ${item.raw} leads`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: COLORS.grid },
            ticks: { color: COLORS.text, precision: 0 },
            beginAtZero: true,
          },
          y: {
            grid: { display: false },
            ticks: { color: COLORS.text },
          },
        },
      },
    });
  },
};
