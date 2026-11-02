// =============================================================
// reports.js — مُحدَّث مع قسم التحليلات ومقارنة الفترات
// =============================================================

import { initPage, formatCurrency, formatDate, escapeHtml, showToast } from '../init.js';
import { initDynamicSidebar } from '../sidebar.js';
import { hasPermission } from '../permissions.js';
import {
  computeAnalyticsSummary, formatGrowthBadge,
} from '../analytics-engine.js';
import { computeFinancialSummary } from '../accounting.js';

const state = {
  currentFilter: '30',
  dateFrom: null,
  dateTo: null,
  charts: {},
};

initPage({
  onReady: async () => {
    if (!hasPermission('canViewReports')) {
      window.location.href = 'dashboard.html';
      return;
    }
    initDynamicSidebar();

    // فلاتر
    document.querySelectorAll('.filter-btn').forEach((btn) => {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
        this.classList.add('active');
        state.currentFilter = this.dataset.filter;

        if (state.currentFilter === 'custom') {
          const from = document.getElementById('dateFrom')?.value;
          const to = document.getElementById('dateTo')?.value;
          if (from && to) {
            state.dateFrom = from;
            state.dateTo = to;
          } else {
            state.currentFilter = '30';
            document.querySelector('.filter-btn[data-filter="30"]')?.classList.add('active');
            showToast('يرجى تحديد التاريخ', 'warning');
            return;
          }
        }
        loadReports();
      });
    });

    document.getElementById('applyCustomDate')?.addEventListener('click', () => {
      const from = document.getElementById('dateFrom')?.value;
      const to = document.getElementById('dateTo')?.value;
      if (!from || !to) {
        showToast('يرجى تحديد التاريخ', 'warning');
        return;
      }
      state.dateFrom = from;
      state.dateTo = to;
      state.currentFilter = 'custom';
      document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
      loadReports();
    });

    // تصدير
    document.getElementById('exportExcelBtn')?.addEventListener('click', exportToExcel);
    document.getElementById('exportPdfBtn')?.addEventListener('click', exportToPdf);
    document.getElementById('printBtn')?.addEventListener('click', printReport);

    // تحميل أولي
    loadReports();
  },
});

async function getDateRange() {
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  let from = new Date(now);
  let to = new Date(now);

  switch (state.currentFilter) {
    case '7': from.setDate(now.getDate() - 7); break;
    case '30': from.setDate(now.getDate() - 30); break;
    case '90': from.setMonth(now.getMonth() - 3); break;
    case '365': from.setFullYear(now.getFullYear() - 1); break;
    case 'custom':
      if (state.dateFrom && state.dateTo) {
        from = new Date(state.dateFrom + 'T00:00:00');
        to = new Date(state.dateTo + 'T23:59:59');
      } else return null;
      break;
    case 'all':
    default: return null;
  }
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

async function loadReports() {
  const range = await getDateRange();
  if (!range) return;

  try {
    // استخدام analytics-engine للملخص
    const summary = await computeAnalyticsSummary(range.from, range.to);

    updateStatsCards(summary);
    updateGrowthSection(summary);
    updateCharts(summary);

    showToast('تم تحميل التقارير', 'success');
  } catch (error) {
    console.error('Reports error:', error);
    showToast('تعذّر تحميل التقارير', 'error');
  }
}

function updateStatsCards(s) {
  const c = s.current;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  set('statCustomers', c.ordersCount); // مؤقت
  set('statOrders', c.ordersCount);
  set('statRevenue', formatCurrency(c.earnedRevenue));
  set('statPayments', formatCurrency(c.collectedCash));
}

function updateGrowthSection(s) {
  // حقن قسم النمو إذا لم يوجد
  let growthSection = document.getElementById('growthSection');
  if (!growthSection) {
    const workspace = document.getElementById('workspace');
    if (!workspace) return;
    growthSection = document.createElement('div');
    growthSection.id = 'growthSection';
    growthSection.className = 'ana-section';
    growthSection.style.cssText = 'background:var(--bg-card); border:1px solid var(--border-color); border-radius:12px; padding:20px; margin-bottom:20px;';
    workspace.insertBefore(growthSection, workspace.firstChild);
  }

  const g = s.growth;
  const metrics = [
    { label: 'نمو الإيراد', value: g.earnedRevenue, invert: false },
    { label: 'نمو النقد المحصّل', value: g.collectedCash, invert: false },
    { label: 'نمو الربح', value: g.netProfit, invert: false },
    { label: 'نمو المصروفات', value: g.totalExpenses, invert: true },
    { label: 'نمو الطلبات', value: g.ordersCount, invert: false },
    { label: 'نمو المدفوعات المعتمدة', value: g.approvedPaymentsCount, invert: false },
  ];

  let html = '<h5 class="mb-3"><i class="fas fa-chart-line text-primary"></i> معدلات النمو (مقارنة بالفترة السابقة)</h5>';
  html += '<div class="row g-3">';

  for (const m of metrics) {
    const badge = formatGrowthBadge(m.value);
    const cls = m.invert
      ? (m.value > 0 ? 'growth-neg' : m.value < 0 ? 'growth-pos' : 'text-muted')
      : badge.class;
    html += `
      <div class="col-md-2 col-6">
        <div class="text-center p-3 border rounded">
          <div class="text-muted small">${m.label}</div>
          <div class="fw-bold fs-5 ${cls}">${badge.arrow} ${badge.text}</div>
        </div>
      </div>
    `;
  }

  html += '</div>';

  // قمع التحويل
  const f = s.funnel;
  html += '<h5 class="mt-4 mb-3"><i class="fas fa-filter text-primary"></i> قمع التحويل</h5>';
  html += `<div class="row text-center">
    <div class="col-md-3"><div class="text-muted small">استفسارات</div><div class="fw-bold fs-4">${f.inquiries}</div></div>
    <div class="col-md-3"><div class="text-muted small">تحويل لطلبات</div><div class="fw-bold fs-4 text-success">${f.convertedToOrders}</div></div>
    <div class="col-md-3"><div class="text-muted small">معدل التحويل</div><div class="fw-bold fs-4 text-primary">${f.inquiryToOrderRate.toFixed(1)}%</div></div>
    <div class="col-md-3"><div class="text-muted small">معدل الإكمال</div><div class="fw-bold fs-4 text-success">${f.completionRate.toFixed(1)}%</div></div>
  </div>`;

  // متوسط قيمة الطلب
  html += `<div class="alert alert-info mt-3">
    <strong>متوسط قيمة الطلب:</strong> ${formatCurrency(s.avgOrderValue)}
    <span class="ms-3"><strong>متوسط الإيراد الشهري:</strong> ${formatCurrency(s.current.earnedRevenue)}</span>
  </div>`;

  growthSection.innerHTML = html;
}

function updateCharts(s) {
  // استخدام نفس منطق analytics
  const revData = s.revenueSeries.slice(-6);
  const labels = revData.map((r) => r.period.split('-').reverse().join('/'));

  // مخطط الإيرادات
  const ctx1 = document.getElementById('monthlyRevenueChart');
  if (ctx1) {
    if (state.charts.revenue) state.charts.revenue.destroy();
    state.charts.revenue = new Chart(ctx1, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'الإيرادات',
          data: revData.map((r) => r.sum),
          backgroundColor: 'rgba(255,102,0,0.7)',
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    });
  }
}

function exportToExcel() {
  const activeTab = document.querySelector('#reportTabs .nav-link.active');
  if (!activeTab) { showToast('لا يوجد جدول', 'warning'); return; }
  const tabId = activeTab.getAttribute('data-bs-target')?.replace('#', '');
  const container = document.getElementById(tabId);
  const table = container?.querySelector('table');
  if (!table) { showToast('لا يوجد جدول', 'warning'); return; }
  try {
    if (typeof XLSX === 'undefined') {
      showToast('مكتبة Excel غير متاحة', 'error');
      return;
    }
    const wb = XLSX.utils.table_to_book(table, { sheet: 'تقرير' });
    XLSX.writeFile(wb, `تقرير_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast('تم التصدير', 'success');
  } catch (e) { showToast('خطأ في التصدير', 'error'); }
}

async function exportToPdf() {
  try {
    if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
      showToast('مكتبات PDF غير متاحة', 'error');
      return;
    }
    const container = document.getElementById('workspace');
    const canvas = await html2canvas(container, { scale: 2, backgroundColor: '#ffffff' });
    const imgData = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const w = pdf.internal.pageSize.getWidth();
    const h = (canvas.height * w) / canvas.width;
    pdf.addImage(imgData, 'PNG', 0, 0, w, h);
    pdf.save(`تقرير_${new Date().toISOString().slice(0, 10)}.pdf`);
    showToast('تم التصدير', 'success');
  } catch (e) { showToast('خطأ في التصدير', 'error'); }
}

function printReport() {
  window.print();
}

console.log('✅ reports.js loaded (updated with analytics and growth)');
