/**
 * chart-helper.js — Balance sparkline using Chart.js
 * Shows a mini line chart of recent balance readings
 */

let balanceChart = null;
const MAX_POINTS = 12;
const balanceHistory = [];

/**
 * Initialize the sparkline chart
 */
export function initBalanceChart() {
  const canvas = document.getElementById('balanceChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const ctx = canvas.getContext('2d');

  // Gradient fill
  const gradient = ctx.createLinearGradient(0, 0, 0, 70);
  gradient.addColorStop(0, 'rgba(167, 139, 250, 0.3)');
  gradient.addColorStop(1, 'rgba(167, 139, 250, 0)');

  balanceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        data: [],
        borderColor: '#a78bfa',
        backgroundColor: gradient,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: '#a78bfa',
        fill: true,
        tension: 0.4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeInOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          callbacks: {
            label: (ctx) => ` ${ctx.parsed.y.toFixed(4)} XLM`,
          },
          backgroundColor: 'rgba(11, 15, 30, 0.9)',
          borderColor: 'rgba(167, 139, 250, 0.3)',
          borderWidth: 1,
          titleColor: '#94a3c4',
          bodyColor: '#f0f4ff',
          padding: 8,
        },
      },
      scales: {
        x: { display: false },
        y: {
          display: false,
          // Give some padding so the line doesn't clip
          ticks: { display: false },
          grid: { display: false },
        }
      },
      interaction: { intersect: false, mode: 'index' },
    }
  });
}

/**
 * Update the sparkline with a new balance reading
 * @param {number} balance — XLM balance as a number
 */
export function updateBalanceChart(balance) {
  if (!balanceChart) return;

  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  balanceHistory.push({ label: now, value: balance });

  if (balanceHistory.length > MAX_POINTS) {
    balanceHistory.shift();
  }

  balanceChart.data.labels = balanceHistory.map(p => p.label);
  balanceChart.data.datasets[0].data = balanceHistory.map(p => p.value);

  // Recompute gradient in case canvas resized
  const ctx = balanceChart.ctx;
  const gradient = ctx.createLinearGradient(0, 0, 0, 70);
  gradient.addColorStop(0, 'rgba(167, 139, 250, 0.3)');
  gradient.addColorStop(1, 'rgba(167, 139, 250, 0)');
  balanceChart.data.datasets[0].backgroundColor = gradient;

  balanceChart.update();
}

/**
 * Destroy the chart (call on disconnect)
 */
export function destroyBalanceChart() {
  if (balanceChart) {
    balanceChart.destroy();
    balanceChart = null;
    balanceHistory.length = 0;
  }
}
