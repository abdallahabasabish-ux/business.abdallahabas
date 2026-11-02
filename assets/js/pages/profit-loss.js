// =============================================================
// profit-loss.js — تقرير الأرباح والخسائر
// =============================================================

import { db } from '../firebase-config.js';
import { initPage, escapeHtml, showToast } from '../init.js';
import { initDynamicSidebar } from '../sidebar.js';
import { requireAccountant } from '../permissions.js';
import {
  computeFinancialSummary, computeComparison,
  formatCurrency, formatPercent,
} from '../accounting.js';

let currentPeriod = '30';
let customDateFrom = null;
let customDateTo = null;
let chartInstance = null;

initPage({
  onReady: async () => {
    if (!requireAccountant()) return;
    initDynamicSidebar();

    // فلاتر زمنية
    document.querySelectorAll('.filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentPeriod = btn.dataset.period;
        customDateFrom = null;
        customDateTo = null;
        loadData();
      });
    });

    document.getElementById('applyCustomDate')?.addEventListener('click', () => {
      const from = document.getElementById('dateFrom').value;
      const to = document.getElementById('dateTo').value;
      if (!from || !to) {
        showToast('حدد تاريخ البداية والنهاية', 'warning');
        return;
      }
      customDateFrom = from;
      customDateTo = to;
      document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
      currentPeriod = 'custom';
      loadData();
    });

    loadData();
  },
});

async function loadData() {
  document.getElementById('plLoading').style.display = '';
  document.getElementById('plContent').style.display = 'none';

  try {
    let dateFrom, dateTo;

    if (currentPeriod === 'custom') {
      dateFrom = customDateFrom;
      dateTo = customDateTo;
    } else if (currentPeriod === 'all') {
      dateFrom = null;
      dateTo = null;
    } else {
      const days = parseInt(currentPeriod);
      const now = new Date();
      now.setHours(23, 59, 59, 999);
      const from = new Date(now);
      from.setDate(from.getDate() - days);
      from.setHours(0, 0, 0, 0);
      dateFrom = from;
      dateTo = now;
    }

    // الحصول على الملخص المالي
    const summary = await computeFinancialSummary(dateFrom, dateTo);

    // الحصول على المقارنة (للفترة السابقة)
    let comparison = null;
    if (currentPeriod !== 'all' && currentPeriod !== 'custom') {
      const days = parseInt(currentPeriod);
      comparison = await computeComparison(days);
    }

    renderSummary(summary, comparison);
    renderExpensesBreakdown(summary);
    renderChart(summary);

    document.getElementById('plLoading').style.display = 'none';
    document.getElementById('plContent').style.display = '';
  } catch (error) {
    console.error('Error loading P&L:', error);
    showToast('تعذّر تحميل التقرير: ' + error.message, 'error');
    document.getElementById('plLoading').innerHTML =
      `<div class="text-danger"><i class="fas fa-exclamation-circle fa-2x"></i><p>تعذّر تحميل البيانات</p></div>`;
  }
}

function renderSummary(s, comp) {
  // KPIs
  setVal('kpiEarned', formatCurrency(s.earnedRevenue));
  setVal('kpiCollected', formatCurrency(s.collectedCash));
  setVal('kpiPending', `${formatCurrency(s.pendingCash)} معلّقة`);
  setVal('kpiExpenses', formatCurrency(s.totalExpenses));
  setVal('kpiNetProfit', formatCurrency(s.netProfit));
  setVal('kpiMargin', `هامش ${s.profitMargin.toFixed(1)}%`);

  // تغييرات
  if (comp) {
    setHTML('changeEarned', formatChangeBadge(comp.change.earnedRevenue));
    setHTML('changeExpenses', formatChangeBadge(comp.change.totalExpenses));
  }

  // الإيرادات
  setVal('revEarned', formatCurrency(s.earnedRevenue));
  setVal('revCollected', formatCurrency(s.collectedCash));
  setVal('revPending', formatCurrency(s.pendingCash));
  setVal('revOutstanding', formatCurrency(s.outstandingReceivables));
  setVal('revDiscounts', formatCurrency(s.discountsTotal));

  // الموظفون
  setVal('empEarnings', formatCurrency(s.earningsTotal));
  setVal('empBonuses', formatCurrency(s.bonusesTotal));
  setVal('empDeductions', formatCurrency(s.deductionsTotal));
  setVal('empPayouts', formatCurrency(s.payoutsTotal));
  setVal('empTotal', formatCurrency(s.employeeCompensation));
  setVal('empPayable', formatCurrency(s.employeeLiabilities));

  // الخزينة
  setVal('treasuryDeposits', formatCurrency(s.deposits));
  setVal('treasuryWithdrawals', formatCurrency(s.withdrawals));
  setVal('treasuryTransfers', formatCurrency(s.transfers));
  setVal('treasuryBalance', formatCurrency(s.cashBalance));

  // الخلاصة
  setVal('sumEarned', formatCurrency(s.earnedRevenue));
  setVal('sumExpenses', formatCurrency(s.totalExpenses));
  setVal('sumEmployee', formatCurrency(s.employeeCompensation));
  setVal('sumNetProfit', formatCurrency(s.netProfit));
  setVal('sumMargin', `${s.profitMargin.toFixed(1)}%`);
}

function renderExpensesBreakdown(s) {
  const container = document.getElementById('expensesBreakdown');
  const categories = s.expensesByCategory;
  const labels = s.expenseCategories || {};

  const entries = Object.entries(categories).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    container.innerHTML = '<p class="text-muted">لا توجد مصروفات في هذه الفترة</p>';
    return;
  }

  let html = '';
  for (const [cat, amount] of entries) {
    const label = labels[cat] || cat;
    const pct = s.totalExpenses > 0 ? (amount / s.totalExpenses * 100).toFixed(1) : 0;
    html += `
      <div class="pl-row">
        <span class="label">${escapeHtml(label)} <small class="text-muted">(${pct}%)</small></span>
        <span class="value text-danger">${formatCurrency(amount)}</span>
      </div>
    `;
  }
  html += `<div class="pl-row" style="border-top: 2px solid var(--color-primary); margin-top: 8px;">
    <span class="label fw-bold">إجمالي المصروفات</span>
    <span class="value text-danger">${formatCurrency(s.totalExpenses)}</span>
  </div>`;
  container.innerHTML = html;
}

function renderChart(s) {
  const ctx = document.getElementById('expensesChart');
  if (!ctx) return;
  if (chartInstance) chartInstance.destroy();

  const categories = s.expensesByCategory;
  const labels = s.expenseCategories || {};
  const entries = Object.entries(categories).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    ctx.parentElement.innerHTML = '<p class="text-muted text-center">لا توجد بيانات للعرض</p>';
    return;
  }

  const colors = ['#ff6600', '#0d6efd', '#28a745', '#dc3545', '#ffc107', '#17a2b8', '#6c757d', '#8b5cf6', '#fd7e14'];

  chartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: entries.map(([c]) => labels[c] || c),
      datasets: [{
        data: entries.map(([, v]) => v),
        backgroundColor: colors.slice(0, entries.length),
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      cutout: '60%',
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, padding: 12 } },
      },
    },
  });
}

function formatChangeBadge(percent) {
  if (percent === 0) return '<small class="text-muted">—</small>';
  const cls = percent > 0 ? 'change-pos' : 'change-neg';
  const arrow = percent > 0 ? '↑' : '↓';
  return `<small class="${cls}">${arrow} ${Math.abs(percent).toFixed(1)}%</small>`;
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

console.log('✅ profit-loss.js loaded');
