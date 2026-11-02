// =============================================================
// expenses.js — إدارة المصروفات
// =============================================================

import { db } from '../firebase-config.js';
import {
  collection, addDoc, doc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, getDocs, serverTimestamp,
} from 'firebase/firestore';
import { initPage, formatDate, escapeHtml, showToast } from '../init.js';
import { initDynamicSidebar } from '../sidebar.js';
import { requireAccountant } from '../permissions.js';
import { EXPENSE_CATEGORIES, formatCurrency } from '../accounting.js';

let expenses = [];
let orders = [];
let editingId = null;
let expensesListener = null;
let expenseModalInstance = null;

initPage({
  onReady: async () => {
    if (!requireAccountant()) return;
    initDynamicSidebar();
    await loadOrders();
    populateCategorySelects();
    listenToExpenses();

    document.getElementById('addExpenseBtn')?.addEventListener('click', openAddModal);
    document.getElementById('saveExpenseBtn')?.addEventListener('click', saveExpense);
    document.getElementById('searchInput')?.addEventListener('input', applyFilters);
    document.getElementById('categoryFilter')?.addEventListener('change', applyFilters);

    document.getElementById('expDate').value = new Date().toISOString().slice(0, 10);

    const modalEl = document.getElementById('expenseModal');
    if (modalEl) {
      expenseModalInstance = new bootstrap.Modal(modalEl);
      modalEl.addEventListener('hidden.bs.modal', () => {
        document.getElementById('expenseForm').reset();
        document.getElementById('expenseId').value = '';
        editingId = null;
      });
    }
  },
});

async function loadOrders() {
  try {
    const snap = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc')));
    orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const select = document.getElementById('expOrder');
    if (select) {
      select.innerHTML = '<option value="">بدون طلب</option>';
      orders.forEach((o) => {
        const opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = `#${o.orderNumber || 'N/A'} — ${o.notes || o.description || 'طلب'}`;
        select.appendChild(opt);
      });
    }
  } catch (e) { console.error(e); }
}

function populateCategorySelects() {
  const filter = document.getElementById('categoryFilter');
  const select = document.getElementById('expCategory');
  const opts = EXPENSE_CATEGORIES.map((c) => `<option value="${c.value}">${c.label}</option>`).join('');
  if (filter) filter.innerHTML = `<option value="">كل الفئات</option>${opts}`;
  if (select) select.innerHTML = opts;
}

function listenToExpenses() {
  if (expensesListener) expensesListener();
  const q = query(collection(db, 'expenses'), orderBy('date', 'desc'));
  expensesListener = onSnapshot(q, (snapshot) => {
    expenses = snapshot.docs.map((d) => ({
      id: d.id, ...d.data(),
      date: d.data().date?.toDate?.() || d.data().date || null,
    }));
    applyFilters();
    updateStats();
  }, (error) => {
    console.error('Error:', error);
    showToast('حدث خطأ في تحميل المصروفات', 'error');
  });
}

function applyFilters() {
  const search = document.getElementById('searchInput')?.value.trim().toLowerCase() || '';
  const cat = document.getElementById('categoryFilter')?.value || '';
  let filtered = expenses;
  if (cat) filtered = filtered.filter((e) => e.category === cat);
  if (search) filtered = filtered.filter((e) => (e.description || '').toLowerCase().includes(search));
  renderTable(filtered);
}

function getCategoryLabel(value) {
  const cat = EXPENSE_CATEGORIES.find((c) => c.value === value);
  return cat ? cat.label : value || 'أخرى';
}

function getCategoryBadge(value) {
  const colors = {
    operating: 'bg-info text-dark', marketing: 'bg-warning text-dark',
    software: 'bg-primary', hosting: 'bg-secondary', salaries: 'bg-success',
    task_payments: 'bg-info', utilities: 'bg-light text-dark', rent: 'bg-danger',
    other: 'bg-light text-dark',
  };
  const cls = colors[value] || 'bg-secondary';
  return `<span class="cat-badge ${cls}">${escapeHtml(getCategoryLabel(value))}</span>`;
}

function renderTable(list) {
  const tbody = document.getElementById('expensesTableBody');
  if (!tbody) return;
  if (!list || list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">لا توجد مصروفات</td></tr>`;
    return;
  }
  let html = '';
  list.forEach((exp, i) => {
    html += `
      <tr>
        <td>${i + 1}</td>
        <td>${formatDate(exp.date)}</td>
        <td><strong>${escapeHtml(exp.description || '')}</strong></td>
        <td>${getCategoryBadge(exp.category)}</td>
        <td class="fw-bold text-danger">${formatCurrency(exp.amount)}</td>
        <td>${escapeHtml(exp.paymentMethod || '-')}</td>
        <td>${exp.orderId ? `<a href="orders.html" class="text-primary">مرتبط</a>` : '-'}</td>
        <td>${escapeHtml(exp.notes || '')}</td>
        <td>
          <button class="btn btn-sm btn-outline-primary edit-btn" data-id="${exp.id}"><i class="fas fa-edit"></i></button>
          <button class="btn btn-sm btn-outline-danger delete-btn" data-id="${exp.id}"><i class="fas fa-trash"></i></button>
        </td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
  tbody.querySelectorAll('.edit-btn').forEach((b) => b.addEventListener('click', () => openEditModal(b.dataset.id)));
  tbody.querySelectorAll('.delete-btn').forEach((b) => b.addEventListener('click', () => confirmDelete(b.dataset.id)));
}

function updateStats() {
  const total = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const now = new Date();
  const thisMonth = expenses.filter((e) => {
    const d = e.date;
    if (!d) return false;
    const date = d instanceof Date ? d : new Date(d);
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  }).reduce((s, e) => s + (e.amount || 0), 0);

  document.getElementById('statTotal').textContent = formatCurrency(total);
  document.getElementById('statThisMonth').textContent = formatCurrency(thisMonth);
  document.getElementById('statCount').textContent = expenses.length;
  document.getElementById('statAvg').textContent = formatCurrency(expenses.length > 0 ? total / expenses.length : 0);
}

function openAddModal() {
  editingId = null;
  document.getElementById('expenseModalTitle').textContent = 'مصروف جديد';
  document.getElementById('expenseForm').reset();
  document.getElementById('expenseId').value = '';
  document.getElementById('expDate').value = new Date().toISOString().slice(0, 10);
  if (expenseModalInstance) expenseModalInstance.show();
}

function openEditModal(id) {
  const exp = expenses.find((e) => e.id === id);
  if (!exp) { showToast('المصروف غير موجود', 'error'); return; }
  editingId = id;
  document.getElementById('expenseModalTitle').textContent = 'تعديل المصروف';
  document.getElementById('expenseId').value = id;
  document.getElementById('expDescription').value = exp.description || '';
  document.getElementById('expAmount').value = exp.amount || '';
  document.getElementById('expCategory').value = exp.category || 'other';
  document.getElementById('expDate').value = formatDate(exp.date);
  document.getElementById('expPaymentMethod').value = exp.paymentMethod || 'cash';
  document.getElementById('expOrder').value = exp.orderId || '';
  document.getElementById('expNotes').value = exp.notes || '';
  if (expenseModalInstance) expenseModalInstance.show();
}

async function saveExpense() {
  const description = document.getElementById('expDescription').value.trim();
  const amount = parseFloat(document.getElementById('expAmount').value);
  const category = document.getElementById('expCategory').value;
  const date = document.getElementById('expDate').value;

  if (!description || !amount || amount <= 0 || !category || !date) {
    showToast('جميع الحقول مطلوبة', 'warning');
    return;
  }

  const data = {
    description,
    amount,
    category,
    date: new Date(date + 'T00:00:00'),
    paymentMethod: document.getElementById('expPaymentMethod').value,
    orderId: document.getElementById('expOrder').value || null,
    notes: document.getElementById('expNotes').value.trim(),
    updatedAt: new Date().toISOString(),
  };

  const btn = document.getElementById('saveExpenseBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>جاري...';

  try {
    const id = document.getElementById('expenseId').value;
    if (id) {
      await updateDoc(doc(db, 'expenses', id), data);
      showToast('تم تحديث المصروف', 'success');
    } else {
      data.createdAt = serverTimestamp();
      data.createdBy = auth.currentUser?.uid || null;
      await addDoc(collection(db, 'expenses'), data);
      showToast('تم إضافة المصروف', 'success');
    }
    if (expenseModalInstance) expenseModalInstance.hide();
  } catch (error) {
    console.error('Error:', error);
    showToast('تعذّر الحفظ: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save me-2"></i>حفظ';
  }
}

async function confirmDelete(id) {
  const exp = expenses.find((e) => e.id === id);
  if (!exp) return;
  const result = await Swal.fire({
    title: 'حذف المصروف؟', text: `"${exp.description}" — ${formatCurrency(exp.amount)}`,
    icon: 'warning', showCancelButton: true,
    confirmButtonColor: '#dc3545', confirmButtonText: 'نعم، احذف', cancelButtonText: 'إلغاء',
  });
  if (!result.isConfirmed) return;
  try {
    await deleteDoc(doc(db, 'expenses', id));
    showToast('تم حذف المصروف', 'success');
  } catch (e) { showToast('تعذّر الحذف', 'error'); }
}

// استيراد auth من firebase-config (مطلوب لـ createdBy)
import { auth } from '../firebase-config.js';

console.log('✅ expenses.js loaded');
