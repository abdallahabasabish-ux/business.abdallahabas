// =============================================================
// portal-dashboard.js — لوحة تحكم بوابة العميل
// =============================================================
// يعرض للعميل:
// - إحصائياته (إجمالي/جارية/مكتملة/مستحق)
// - آخر 5 طلبات
// - المدفوعات المعلقة (status=pending)
// - زر طلب خدمة جديدة
// =============================================================

import { auth, db } from './firebase-config.js';
import {
  onAuthStateChanged, signOut,
} from 'firebase/auth';
import {
  collection, query, where, orderBy, limit, onSnapshot,
} from 'firebase/firestore';

// =============================================================
// 1. دوال مساعدة
// =============================================================
function formatCurrency(amount, currency = '$') {
  if (amount === undefined || amount === null || isNaN(amount)) {
    return `${currency}0.00`;
  }
  return `${currency}${Number(amount).toFixed(2)}`;
}

function formatDate(date) {
  if (!date) return '-';
  if (date.toDate && typeof date.toDate === 'function') date = date.toDate();
  if (date instanceof Date) return date.toISOString().slice(0, 10);
  if (typeof date === 'string') return date.slice(0, 10);
  return '-';
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

function showToast(message, type = 'success') {
  const colors = {
    success: 'linear-gradient(to right, #00b09b, #96c93d)',
    error: 'linear-gradient(to right, #ff5f6d, #ffc371)',
    warning: 'linear-gradient(to right, #f7971e, #ffd200)',
    info: 'linear-gradient(to right, #ff6600, #ff8533)',
  };
  if (typeof Toastify !== 'undefined') {
    Toastify({
      text: message,
      duration: 3500,
      gravity: 'bottom',
      position: 'left',
      style: { background: colors[type] || colors.info },
      className: 'rounded-3 shadow',
    }).showToast();
  }
}

function statusBadge(status) {
  const map = {
    'جديد': 'status-new',
    'قيد التنفيذ': 'status-progress',
    'مكتمل': 'status-complete',
    'ملغي': 'status-cancelled',
  };
  const cls = map[status] || 'status-new';
  return `<span class="order-status-badge ${cls}">${escapeHtml(status || 'جديد')}</span>`;
}

// =============================================================
// 2. تهيئة البوابة
// =============================================================
let currentCustomerUid = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'portal-login.html';
    return;
  }

  currentCustomerUid = user.uid;
  document.getElementById('welcomeName').textContent =
    `مرحباً ${user.displayName || user.email}`;

  // إظهار المحتوى
  document.getElementById('portalLoading').style.display = 'none';
  document.getElementById('portalContent').style.display = 'block';

  // تحميل البيانات
  loadOrders();
  loadPendingPayments();
  loadStats();

  // زر الخروج
  document.getElementById('portalLogoutBtn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await signOut(auth);
      window.location.href = 'portal-login.html';
    } catch (err) {
      showToast('تعذّر تسجيل الخروج', 'error');
    }
  });

  // زر طلب خدمة جديدة
  document.getElementById('newServiceRequestBtn')?.addEventListener('click', () => {
    window.location.href = 'portal-orders.html?action=new';
  });
});

// =============================================================
// 3. تحميل الطلبات (Realtime)
// =============================================================
let allOrders = [];

function loadOrders() {
  const q = query(
    collection(db, 'orders'),
    where('customerUid', '==', currentCustomerUid),
    orderBy('createdAt', 'desc'),
    limit(5)
  );

  onSnapshot(q, (snapshot) => {
    allOrders = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    renderRecentOrders(allOrders);
    updateStatsFromOrders();
  }, (error) => {
    console.warn('Could not load orders:', error);
    document.getElementById('recentOrders').innerHTML =
      '<p class="text-muted text-center py-3">لا توجد طلبات بعد</p>';
  });
}

function renderRecentOrders(orders) {
  const container = document.getElementById('recentOrders');

  if (!orders || orders.length === 0) {
    container.innerHTML = `
      <div class="text-center py-4">
        <i class="fas fa-inbox fa-2x text-muted mb-2"></i>
        <p class="text-muted">لا توجد طلبات بعد</p>
        <a href="portal-orders.html?action=new" class="btn btn-sm btn-accent">أرسل طلبك الأول</a>
      </div>
    `;
    return;
  }

  let html = '';
  for (const order of orders) {
    const completionRate = order.completionRate || 0;
    const total = order.total || 0;
    const paid = order.paid || 0;
    const remaining = total - paid;

    html += `
      <div class="d-flex justify-content-between align-items-center py-3 border-bottom">
        <div>
          <strong>#${escapeHtml(order.orderNumber || 'N/A')}</strong>
          <div class="text-muted small">${escapeHtml(order.notes || 'طلب خدمة')}</div>
          <div class="text-muted small">${formatDate(order.createdAt)}</div>
        </div>
        <div class="text-center">
          ${statusBadge(order.status)}
          <div class="text-muted small mt-1">الإنجاز: ${completionRate}%</div>
        </div>
        <div class="text-end">
          <div class="fw-bold">${formatCurrency(total)}</div>
          ${remaining > 0
            ? `<div class="text-danger small">متبقّي: ${formatCurrency(remaining)}</div>`
            : `<div class="text-success small"><i class="fas fa-check"></i> مدفوع</div>`}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

// =============================================================
// 4. تحميل المدفوعات المعلقة
// =============================================================
function loadPendingPayments() {
  // المدفوعات المعلّقة = الطلبات غير المدفوعة بالكامل
  // نعرضها من allOrders
  renderPendingPayments();
}

function renderPendingPayments() {
  const container = document.getElementById('pendingPayments');

  const unpaidOrders = allOrders.filter(
    (o) => (o.total || 0) - (o.paid || 0) > 0 && o.status !== 'ملغي'
  );

  if (unpaidOrders.length === 0) {
    container.innerHTML = `
      <div class="text-center py-4">
        <i class="fas fa-check-circle fa-2x text-success mb-2"></i>
        <p class="text-success">لا توجد مدفوعات معلّقة. شكراً لك!</p>
      </div>
    `;
    return;
  }

  let html = '';
  for (const order of unpaidOrders) {
    const remaining = (order.total || 0) - (order.paid || 0);
    html += `
      <div class="d-flex justify-content-between align-items-center py-3 border-bottom">
        <div>
          <strong>#${escapeHtml(order.orderNumber || 'N/A')}</strong>
          <div class="text-muted small">المتبقّي: ${formatCurrency(remaining)}</div>
        </div>
        <a href="portal-payments.html?orderId=${order.id}" class="btn btn-sm btn-primary">
          <i class="fas fa-upload me-1"></i>رفع إثبات الدفع
        </a>
      </div>
    `;
  }

  container.innerHTML = html;
}

// =============================================================
// 5. تحديث الإحصائيات
// =============================================================
function updateStatsFromOrders() {
  const total = allOrders.length;
  const active = allOrders.filter((o) => o.status === 'قيد التنفيذ' || o.status === 'جديد').length;
  const completed = allOrders.filter((o) => o.status === 'مكتمل').length;
  const outstanding = allOrders
    .filter((o) => o.status !== 'ملغي')
    .reduce((sum, o) => sum + Math.max(0, (o.total || 0) - (o.paid || 0)), 0);

  document.getElementById('statTotalOrders').textContent = total;
  document.getElementById('statActiveOrders').textContent = active;
  document.getElementById('statCompletedOrders').textContent = completed;
  document.getElementById('statOutstanding').textContent = formatCurrency(outstanding);

  // إعادة عرض المدفوعات المعلّقة بعد تحديث الطلبات
  renderPendingPayments();
}

// تحميل إحصائيات منفصلة (احتياطي إذا فشل loadOrders)
function loadStats() {
  // الإحصائيات تُحدّث من loadOrders عبر updateStatsFromOrders
  // هذه الدالة فارغة لكنها جاهزة للتوسعة لاحقًا
}

console.log('✅ portal-dashboard.js loaded');
