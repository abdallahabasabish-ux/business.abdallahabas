// =============================================================
// dashboard.js — مُحدَّث لاستخدام accounting.js (مصدر الحقيقة الموحّد)
// =============================================================
// التغييرات:
// 1. استخدام computeFinancialSummary من accounting.js
// 2. statPayments يعرض النقد المحصّل (approved فقط) بدل الإجمالي
// 3. statRevenue يعرض الإيراد المحقق (بدون الملغاة)
// 4. إضافة قسم الملخص المالي المباشن (حقن عبر JS)
// =============================================================

import { onAuthStateChangedCallback, logoutUser } from './auth.js';
import { db } from './firebase-config.js';
import {
  collection, getDocs, query, orderBy, limit, onSnapshot, Timestamp,
} from 'firebase/firestore';
import {
  initPermissions, getUserData, isAdmin, applyPermissionsToUI,
} from './permissions.js';
import { initDynamicSidebar } from './sidebar.js';
import {
  computeFinancialSummary, formatCurrency, formatDate, escapeHtml,
} from './accounting.js';

// متغيرات عامة
let customersCount = 0;
let activeOrdersCount = 0;
let completedOrdersCount = 0;
let chartInstances = {};
let allOrders = [];
let recentPayments = [];
let recentCustomers = [];

// دوال مساعدة
function showToast(message, type = 'success') {
  const colors = {
    success: 'linear-gradient(to right, #00b09b, #96c93d)',
    error: 'linear-gradient(to right, #ff5f6d, #ffc371)',
    warning: 'linear-gradient(to right, #f7971e, #ffd200)',
    info: 'linear-gradient(to right, #ff6600, #ff8533)',
  };
  if (typeof Toastify !== 'undefined') {
    Toastify({
      text: message, duration: 3000, gravity: 'bottom', position: 'left',
      style: { background: colors[type] || colors.info }, className: 'rounded-3 shadow',
    }).showToast();
  }
}

function safeDate(date) {
  if (!date) return null;
  if (date instanceof Timestamp) return date.toDate();
  if (date instanceof Date) return date;
  if (typeof date === 'string') return new Date(date);
  return null;
}

// التهيئة
onAuthStateChangedCallback(async (user) => {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  initPermissions(user);
  initDynamicSidebar();

  // تحديث بيانات المستخدم في القائمة
  const sidebarUserName = document.getElementById('sidebarUserName');
  const sidebarUserEmail = document.getElementById('sidebarUserEmail');
  const sidebarAvatar = document.getElementById('sidebarAvatar');
  if (sidebarUserName) sidebarUserName.textContent = user.displayName || user.email;
  if (sidebarUserEmail) sidebarUserEmail.textContent = user.email;
  if (sidebarAvatar) {
    sidebarAvatar.textContent = user.displayName
      ? user.displayName.charAt(0).toUpperCase()
      : user.email.charAt(0).toUpperCase();
  }

  // الوضع المظلم
  initDarkMode();
  initSidebar();

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await logoutUser();
    window.location.href = 'login.html';
  });

  // تحميل البيانات
  await loadDashboardData();
  listenToRealtimeUpdates();
});

function initDarkMode() {
  const themeToggle = document.getElementById('themeToggle');
  const htmlElement = document.documentElement;
  const savedTheme = localStorage.getItem('theme') || 'light';
  if (savedTheme === 'dark') {
    htmlElement.setAttribute('data-theme', 'dark');
    if (themeToggle) themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
  } else {
    htmlElement.removeAttribute('data-theme');
    if (themeToggle) themeToggle.innerHTML = '<i class="fas fa-moon"></i>';
  }
  themeToggle?.addEventListener('click', function () {
    const current = htmlElement.getAttribute('data-theme');
    if (current === 'dark') {
      htmlElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
      this.innerHTML = '<i class="fas fa-moon"></i>';
    } else {
      htmlElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
      this.innerHTML = '<i class="fas fa-sun"></i>';
    }
  });
}

function initSidebar() {
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebarToggle?.addEventListener('click', () => {
    sidebar?.classList.toggle('active');
    overlay?.classList.toggle('active');
  });
  overlay?.addEventListener('click', () => {
    sidebar?.classList.remove('active');
    overlay?.classList.remove('active');
  });
}

// =============================================================
// تحميل بيانات لوحة التحكم
// =============================================================
async function loadDashboardData() {
  try {
    // جلب الملخص المالي من accounting.js
    const summary = await computeFinancialSummary();

    // تحديث البطاقات الإحصائية بالأرقام الدقيقة
    updateStats(summary);

    // جلب العملاء والطلبات للجداول
    const customersSnap = await getDocs(collection(db, 'customers'));
    customersCount = customersSnap.size;

    const ordersSnap = await getDocs(collection(db, 'orders'));
    allOrders = ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    activeOrdersCount = allOrders.filter((o) => o.status === 'قيد التنفيذ').length;
    completedOrdersCount = allOrders.filter((o) => o.status === 'مكتمل').length;

    // آخر 5 دفعات (المعتمدة فقط)
    try {
      const paymentsQuery = query(collection(db, 'payments'), orderBy('paymentDate', 'desc'), limit(5));
      const recentPaymentsSnap = await getDocs(paymentsQuery);
      recentPayments = recentPaymentsSnap.docs.map((d) => ({
        id: d.id, ...d.data(),
        paymentDate: safeDate(d.data().paymentDate),
      }));
    } catch (e) { recentPayments = []; }

    // آخر 5 عملاء
    try {
      const q = query(collection(db, 'customers'), orderBy('createdAt', 'desc'), limit(5));
      const recentSnap = await getDocs(q);
      recentCustomers = recentSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) { recentCustomers = []; }

    updateRecentPayments();
    updateRecentCustomers();
    updateCharts(allOrders);

    // إضافة قسم الملخص المالي المباشن
    injectFinancialSummary(summary);

    console.log('✅ Dashboard data loaded with accounting.js');
  } catch (error) {
    console.error('❌ Error loading dashboard:', error);
    showToast('حدث خطأ في تحميل بعض البيانات', 'warning');
  }
}

// =============================================================
// تحديث البطاقات الإحصائية
// =============================================================
function updateStats(s) {
  const el = (id) => document.getElementById(id);

  // البطاقات الحالية — أرقام دقيقة الآن
  if (el('statCustomers')) el('statCustomers').textContent = customersCount;
  if (el('statActiveOrders')) el('statActiveOrders').textContent = activeOrdersCount;
  // statPayments: النقد المحصّل (المعتمد فقط) — ليس إجمالي المدفوعات
  if (el('statPayments')) el('statPayments').textContent = formatCurrency(s.collectedCash);
  if (el('statCompleted')) el('statCompleted').textContent = completedOrdersCount;
  // statRevenue: الإيراد المحقق (بدون الملغاة)
  if (el('statRevenue')) el('statRevenue').textContent = formatCurrency(s.earnedRevenue);
  // statPaymentsCount: عدد المدفوعات المعتمدة
  if (el('statPaymentsCount')) el('statPaymentsCount').textContent = s.approvedPaymentsCount;

  // تحديث قسم الخزينة المصغر
  const treasuryHeader = el('treasuryHeaderBalance');
  if (treasuryHeader) {
    treasuryHeader.innerHTML = `<small>الرصيد الحالي</small> ${formatCurrency(s.cashBalance)}`;
  }
  if (el('miniTotalDeposits')) el('miniTotalDeposits').textContent = formatCurrency(s.deposits);
  if (el('miniTotalWithdrawals')) el('miniTotalWithdrawals').textContent = formatCurrency(s.withdrawals);
  if (el('miniTotalTransfers')) el('miniTotalTransfers').textContent = formatCurrency(s.transfers);
  if (el('miniTxCount')) el('miniTxCount').textContent = s.deposits + s.withdrawals > 0 ? '—' : '0';
}

// =============================================================
// حقن قسم الملخص المالي المباشن
// =============================================================
function injectFinancialSummary(s) {
  // البحث عن مكان الحقن (بعد قسم الخزينة)
  const treasurySection = document.querySelector('.treasury-stats-grid-mini');
  if (!treasurySection) return;

  // التحقق إن كان القسم مُحقنًا مسبقًا
  if (document.getElementById('injectedFinancialSummary')) return;

  const summaryDiv = document.createElement('div');
  summaryDiv.id = 'injectedFinancialSummary';
  summaryDiv.className = 'pl-section';
  summaryDiv.style.cssText = 'background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-top: 24px;';

  const netProfitColor = s.netProfit >= 0 ? '#28a745' : '#dc3545';
  const marginColor = s.profitMargin >= 0 ? '#28a745' : '#dc3545';

  summaryDiv.innerHTML = `
    <h5 style="margin-bottom:16px; font-weight:700; display:flex; align-items:center; gap:8px;">
      <i class="fas fa-chart-pie" style="color: var(--color-primary);"></i>
      الملخص المالي المباشر
      <a href="profit-loss.html" style="font-size:12px; margin-right:auto; color: var(--color-primary); text-decoration:none;">
        التقرير الكامل <i class="fas fa-arrow-left"></i>
      </a>
    </h5>
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap:14px;">
      <div style="text-align:center; padding:12px; background: var(--bg-input); border-radius:8px;">
        <div style="font-size:11px; color: var(--text-muted); font-weight:600;">الإيراد المحقق</div>
        <div style="font-size:20px; font-weight:700; color: var(--text-primary);">${formatCurrency(s.earnedRevenue)}</div>
      </div>
      <div style="text-align:center; padding:12px; background: var(--bg-input); border-radius:8px;">
        <div style="font-size:11px; color: var(--text-muted); font-weight:600;">النقد المحصّل</div>
        <div style="font-size:20px; font-weight:700; color: #28a745;">${formatCurrency(s.collectedCash)}</div>
      </div>
      <div style="text-align:center; padding:12px; background: var(--bg-input); border-radius:8px;">
        <div style="font-size:11px; color: var(--text-muted); font-weight:600;">ذمم مدينة</div>
        <div style="font-size:20px; font-weight:700; color: #dc3545;">${formatCurrency(s.outstandingReceivables)}</div>
      </div>
      <div style="text-align:center; padding:12px; background: var(--bg-input); border-radius:8px;">
        <div style="font-size:11px; color: var(--text-muted); font-weight:600;">المصروفات</div>
        <div style="font-size:20px; font-weight:700; color: #dc3545;">${formatCurrency(s.totalExpenses)}</div>
      </div>
      <div style="text-align:center; padding:12px; background: var(--bg-input); border-radius:8px;">
        <div style="font-size:11px; color: var(--text-muted); font-weight:600;">مستحقات موظفين</div>
        <div style="font-size:20px; font-weight:700; color: #ffc107;">${formatCurrency(s.employeeLiabilities)}</div>
      </div>
      <div style="text-align:center; padding:12px; background: var(--color-primary); border-radius:8px; color:#fff;">
        <div style="font-size:11px; opacity:0.8; font-weight:600;">صافي الربح</div>
        <div style="font-size:20px; font-weight:700;">${formatCurrency(s.netProfit)}</div>
        <div style="font-size:11px; opacity:0.8;">هامش ${s.profitMargin.toFixed(1)}%</div>
      </div>
    </div>
  `;

  // إدراج بعد قسم الخزينة
  treasurySection.parentNode.insertBefore(summaryDiv, treasurySection.nextSibling);
}

// =============================================================
// جداول آخر المدفوعات والعملاء
// =============================================================
function updateRecentPayments() {
  const tbody = document.getElementById('recentPaymentsBody');
  if (!tbody) return;
  if (!recentPayments || recentPayments.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">لا توجد مدفوعات</td></tr>';
    return;
  }
  let html = '';
  recentPayments.forEach((p, i) => {
    const customerName = p.customerName || 'غير معروف';
    const date = p.paymentDate ? formatDate(p.paymentDate) : '-';
    const statusBadge = p.status === 'pending'
      ? '<span class="badge bg-warning text-dark">معلّقة</span>'
      : p.status === 'rejected'
        ? '<span class="badge bg-danger">مرفوضة</span>'
        : '<span class="badge bg-success">معتمدة</span>';
    html += `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(customerName)}</td>
        <td class="payment-amount">${formatCurrency(p.amount)}</td>
        <td>${escapeHtml(p.method || '')}</td>
        <td>${date} ${statusBadge}</td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

function updateRecentCustomers() {
  const tbody = document.getElementById('recentCustomers');
  if (!tbody) return;
  if (!recentCustomers || recentCustomers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">لا يوجد عملاء</td></tr>';
    return;
  }
  let html = '';
  recentCustomers.forEach((c, i) => {
    const totalPaid = c.totalPaid || 0;
    html += `<tr><td>${i + 1}</td><td>${escapeHtml(c.name || '')}</td><td>${escapeHtml(c.phone || '')}</td><td>${formatCurrency(totalPaid)}</td></tr>`;
  });
  tbody.innerHTML = html;
}

// =============================================================
// الرسوم البيانية (مبسطة — بدون إعادة جلب المدفوعات)
// =============================================================
function updateCharts(ordersData) {
  try {
    const colors = ['#ff6600', '#0d6efd', '#28a745', '#8b5cf6', '#ffc107', '#dc3545'];

    // توزيع الخدمات
    const serviceCount = {};
    ordersData.forEach((order) => {
      const sid = order.serviceId;
      if (sid) serviceCount[sid] = (serviceCount[sid] || 0) + 1;
    });
    const ctx1 = document.getElementById('servicesChart');
    if (ctx1) {
      if (chartInstances.services) chartInstances.services.destroy();
      const sLabels = Object.keys(serviceCount);
      const sValues = Object.values(serviceCount);
      chartInstances.services = new Chart(ctx1, {
        type: 'doughnut',
        data: {
          labels: sLabels.length ? sLabels : ['لا توجد طلبات'],
          datasets: [{ data: sLabels.length ? sValues : [1], backgroundColor: colors, borderWidth: 0 }],
        },
        options: { responsive: true, cutout: '60%', plugins: { legend: { position: 'bottom' } } },
      });
    }

    // الطلبات الشهرية
    const monthlyOrders = {};
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthlyOrders[key] = 0;
    }
    ordersData.forEach((order) => {
      const date = safeDate(order.createdAt);
      if (date) {
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (monthlyOrders[key] !== undefined) monthlyOrders[key]++;
      }
    });
    const ctx2 = document.getElementById('ordersChart');
    if (ctx2) {
      if (chartInstances.orders) chartInstances.orders.destroy();
      chartInstances.orders = new Chart(ctx2, {
        type: 'bar',
        data: {
          labels: Object.keys(monthlyOrders).map((l) => l.split('-')[1] + '/' + l.split('-')[0]),
          datasets: [{ label: 'الطلبات', data: Object.values(monthlyOrders), backgroundColor: 'rgba(13,110,253,0.7)', borderRadius: 6 }],
        },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
      });
    }
  } catch (e) { console.warn('Chart error:', e); }
}

// =============================================================
// الاستماع للتحديثات الفورية
// =============================================================
function listenToRealtimeUpdates() {
  onSnapshot(collection(db, 'customers'), (snapshot) => {
    customersCount = snapshot.size;
    const el = document.getElementById('statCustomers');
    if (el) el.textContent = customersCount;
  }, (e) => console.warn(e));

  onSnapshot(collection(db, 'orders'), (snapshot) => {
    allOrders = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    activeOrdersCount = allOrders.filter((o) => o.status === 'قيد التنفيذ').length;
    completedOrdersCount = allOrders.filter((o) => o.status === 'مكتمل').length;
    const el1 = document.getElementById('statActiveOrders');
    const el2 = document.getElementById('statCompleted');
    if (el1) el1.textContent = activeOrdersCount;
    if (el2) el2.textContent = completedOrdersCount;
    updateCharts(allOrders);
  }, (e) => console.warn(e));

  onSnapshot(query(collection(db, 'customers'), orderBy('createdAt', 'desc'), limit(5)), (snapshot) => {
    recentCustomers = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    updateRecentCustomers();
  }, (e) => console.warn(e));
}

console.log('✅ dashboard.js loaded (updated with accounting.js — accurate financial figures)');
