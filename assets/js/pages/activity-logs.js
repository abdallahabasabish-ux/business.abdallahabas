// =============================================================
// activity-logs.js — سجل النشاطات (للعرض فقط — append-only)
// =============================================================

import { db } from '../firebase-config.js';
import {
  collection, query, orderBy, onSnapshot, limit,
} from 'firebase/firestore';
import { initPage, escapeHtml, showToast } from '../init.js';
import { initDynamicSidebar } from '../sidebar.js';
import { requireAdmin } from '../permissions.js';
import { formatDate } from '../accounting.js';

let logs = [];
let logsListener = null;

const ACTION_LABELS = {
  user_login: { label: 'تسجيل دخول', cls: 'la-login' },
  user_logout: { label: 'تسجيل خروج', cls: 'la-login' },
  customer_created: { label: 'إنشاء عميل', cls: 'la-create' },
  customer_updated: { label: 'تعديل عميل', cls: 'la-update' },
  customer_deleted: { label: 'حذف عميل', cls: 'la-delete' },
  order_created: { label: 'إنشاء طلب', cls: 'la-create' },
  order_updated: { label: 'تعديل طلب', cls: 'la-update' },
  order_approved: { label: 'اعتماد طلب', cls: 'la-approve' },
  order_completed: { label: 'إكمال طلب', cls: 'la-approve' },
  order_cancelled: { label: 'إلغاء طلب', cls: 'la-reject' },
  task_created: { label: 'إنشاء مهمة', cls: 'la-create' },
  task_assigned: { label: 'تعيين مهمة', cls: 'la-update' },
  task_completed: { label: 'إكمال مهمة', cls: 'la-approve' },
  task_rejected: { label: 'رفض مهمة', cls: 'la-reject' },
  payment_created: { label: 'تسجيل دفعة', cls: 'la-create' },
  payment_approved: { label: 'اعتماد دفعة', cls: 'la-approve' },
  payment_rejected: { label: 'رفض دفعة', cls: 'la-reject' },
  expense_created: { label: 'تسجيل مصروف', cls: 'la-create' },
  expense_updated: { label: 'تعديل مصروف', cls: 'la-update' },
  expense_deleted: { label: 'حذف مصروف', cls: 'la-delete' },
  treasury_deposit: { label: 'إيداع خزينة', cls: 'la-create' },
  treasury_withdraw: { label: 'سحب خزينة', cls: 'la-update' },
  inquiry_created: { label: 'إنشاء استفسار', cls: 'la-create' },
  inquiry_converted: { label: 'تحويل استفسار', cls: 'la-approve' },
  role_changed: { label: 'تغيير دور', cls: 'la-other' },
  permissions_changed: { label: 'تحديث صلاحيات', cls: 'la-other' },
  user_disabled: { label: 'تعطيل مستخدم', cls: 'la-reject' },
  user_enabled: { label: 'تفعيل مستخدم', cls: 'la-approve' },
  settings_updated: { label: 'تحديث إعدادات', cls: 'la-update' },
  message_sent: { label: 'إرسال رسالة', cls: 'la-create' },
  conversation_created: { label: 'إنشاء محادثة', cls: 'la-create' },
};

initPage({
  onReady: async () => {
    if (!requireAdmin()) return;
    initDynamicSidebar();
    populateFilters();
    listenToLogs();

    document.getElementById('searchInput')?.addEventListener('input', applyFilters);
    document.getElementById('actionFilter')?.addEventListener('change', applyFilters);
    document.getElementById('userFilter')?.addEventListener('change', applyFilters);
    document.getElementById('exportLogsBtn')?.addEventListener('click', exportToExcel);
  },
});

function listenToLogs() {
  if (logsListener) logsListener();
  // آخر 500 سجل فقط للأداء
  const q = query(collection(db, 'activityLogs'), orderBy('createdAt', 'desc'), limit(500));
  logsListener = onSnapshot(q, (snapshot) => {
    logs = snapshot.docs.map((d) => ({
      id: d.id, ...d.data(),
      timestamp: d.data().timestamp || d.data().createdAt || null,
    }));
    populateUserFilter();
    applyFilters();
  }, (e) => {
    console.error(e);
    showToast('تعذّر تحميل السجل', 'error');
  });
}

function populateFilters() {
  const select = document.getElementById('actionFilter');
  if (!select) return;
  const actions = Object.entries(ACTION_LABELS).sort((a, b) => a[1].label.localeCompare(b[1].label));
  select.innerHTML = '<option value="">كل الإجراءات</option>' +
    actions.map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
}

function populateUserFilter() {
  const select = document.getElementById('userFilter');
  if (!select) return;
  const users = {};
  logs.forEach((l) => {
    if (l.userEmail) users[l.userEmail] = l.userName || l.userEmail;
  });
  const entries = Object.entries(users).sort((a, b) => a[1].localeCompare(b[1]));
  select.innerHTML = '<option value="">كل المستخدمين</option>' +
    entries.map(([email, name]) => `<option value="${email}">${name}</option>`).join('');
}

function applyFilters() {
  const search = document.getElementById('searchInput')?.value.trim().toLowerCase() || '';
  const actionF = document.getElementById('actionFilter')?.value || '';
  const userF = document.getElementById('userFilter')?.value || '';

  let filtered = logs;
  if (actionF) filtered = filtered.filter((l) => l.action === actionF);
  if (userF) filtered = filtered.filter((l) => l.userEmail === userF);
  if (search) {
    filtered = filtered.filter((l) =>
      (l.changeSummary || '').toLowerCase().includes(search) ||
      (l.userEmail || '').toLowerCase().includes(search) ||
      (l.action || '').toLowerCase().includes(search)
    );
  }

  renderTable(filtered);
}

function renderTable(list) {
  const tbody = document.getElementById('logsTableBody');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">لا توجد سجلات</td></tr>';
    return;
  }

  let html = '';
  for (const log of list.slice(0, 100)) { // عرض أول 100
    const info = ACTION_LABELS[log.action] || { label: log.action || '-', cls: 'la-other' };
    const time = log.timestamp
      ? (log.timestamp.toDate ? log.timestamp.toDate() : new Date(log.timestamp))
      : null;
    const timeStr = time ? formatDate(time) + ' ' + time.toTimeString().slice(0, 5) : '-';

    html += `
      <tr>
        <td><small>${timeStr}</small></td>
        <td><strong>${escapeHtml(log.userName || log.userEmail || '-')}</strong><br/><small class="text-muted">${escapeHtml(log.userEmail || '')}</small></td>
        <td><span class="badge bg-secondary">${escapeHtml(log.userRole || '-')}</span></td>
        <td><span class="log-action-badge ${info.cls}">${info.label}</span></td>
        <td><small>${escapeHtml(log.relatedCollection || '-')} ${log.relatedRecordId ? '/ ' + escapeHtml(log.relatedRecordId.substring(0, 8)) : ''}</small></td>
        <td>${escapeHtml(log.changeSummary || '-')}</td>
      </tr>
    `;
  }

  if (list.length > 100) {
    html += `<tr><td colspan="6" class="text-center text-muted">عرض 100 من ${list.length} سجل. استخدم الفلاتر لتضييق النتائج.</td></tr>`;
  }

  tbody.innerHTML = html;
}

function exportToExcel() {
  const table = document.getElementById('logsTable');
  if (!table) return;
  try {
    if (typeof XLSX === 'undefined') {
      showToast('مكتبة Excel غير متاحة', 'error');
      return;
    }
    const wb = XLSX.utils.table_to_book(table, { sheet: 'سجل النشاطات' });
    XLSX.writeFile(wb, `سجل_النشاطات_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast('تم التصدير', 'success');
  } catch (e) {
    showToast('خطأ في التصدير', 'error');
  }
}

console.log('✅ activity-logs.js loaded');
