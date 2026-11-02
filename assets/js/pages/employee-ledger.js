// =============================================================
// employee-ledger.js — دفتر أستاذ الموظفين
// =============================================================

import { auth, db } from '../firebase-config.js';
import {
  collection, addDoc, doc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, getDocs, serverTimestamp,
} from 'firebase/firestore';
import { initPage, formatDate, escapeHtml, showToast } from '../init.js';
import { initDynamicSidebar } from '../sidebar.js';
import { requireAccountant } from '../permissions.js';
import { LEDGER_TYPES, formatCurrency } from '../accounting.js';

let entries = [];
let employees = [];
let editingId = null;
let ledgerListener = null;
let entryModalInstance = null;

initPage({
  onReady: async () => {
    if (!requireAccountant()) return;
    initDynamicSidebar();
    await loadEmployees();
    listenToLedger();

    document.getElementById('addEntryBtn')?.addEventListener('click', openAddModal);
    document.getElementById('saveEntryBtn')?.addEventListener('click', saveEntry);
    document.getElementById('employeeFilter')?.addEventListener('change', applyFilters);
    document.getElementById('typeFilter')?.addEventListener('change', applyFilters);
    document.getElementById('processPayoutBtn')?.addEventListener('click', processPayout);

    const modalEl = document.getElementById('entryModal');
    if (modalEl) {
      entryModalInstance = new bootstrap.Modal(modalEl);
      modalEl.addEventListener('hidden.bs.modal', () => {
        document.getElementById('entryForm').reset();
        document.getElementById('entryId').value = '';
        editingId = null;
      });
    }
  },
});

async function loadEmployees() {
  try {
    const snap = await getDocs(collection(db, 'employees'));
    employees = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const filter = document.getElementById('employeeFilter');
    const select = document.getElementById('entryEmployee');
    const opts = employees.map((e) => `<option value="${e.id}" data-uid="${e.uid || ''}">${escapeHtml(e.name)}</option>`).join('');

    if (filter) filter.innerHTML = `<option value="">كل الموظفين</option>${opts}`;
    if (select) select.innerHTML = '<option value="">اختر موظف...</option>' + opts;
  } catch (e) { console.error(e); }
}

function listenToLedger() {
  if (ledgerListener) ledgerListener();
  const q = query(collection(db, 'employeeLedger'), orderBy('createdAt', 'desc'));
  ledgerListener = onSnapshot(q, (snapshot) => {
    entries = snapshot.docs.map((d) => ({
      id: d.id, ...d.data(),
      createdAt: d.data().createdAt?.toDate?.() || d.data().createdAt || null,
    }));
    applyFilters();
    updateStats();
  }, (error) => {
    console.error('Error:', error);
    showToast('حدث خطأ', 'error');
  });
}

function applyFilters() {
  const empFilter = document.getElementById('employeeFilter')?.value || '';
  const typeFilter = document.getElementById('typeFilter')?.value || '';
  let filtered = entries;
  if (empFilter) filtered = filtered.filter((e) => e.employeeId === empFilter);
  if (typeFilter) filtered = filtered.filter((e) => e.type === typeFilter);
  renderTable(filtered);
}

function getTypeInfo(type) {
  return LEDGER_TYPES.find((t) => t.value === type) || LEDGER_TYPES[0];
}

function renderTable(list) {
  const tbody = document.getElementById('ledgerTableBody');
  if (!tbody) return;
  if (!list || list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">لا توجد قيود</td></tr>`;
    return;
  }
  let html = '';
  list.forEach((entry, i) => {
    const emp = employees.find((e) => e.id === entry.employeeId);
    const empName = emp ? emp.name : 'غير معروف';
    const info = getTypeInfo(entry.type);
    const statusBadge = entry.status === 'approved'
      ? '<span class="badge bg-success">معتمد</span>'
      : '<span class="badge bg-warning text-dark">معلّق</span>';

    html += `
      <tr>
        <td>${i + 1}</td>
        <td>${formatDate(entry.createdAt)}</td>
        <td><strong>${escapeHtml(empName)}</strong></td>
        <td><span class="ledger-type lt-${entry.type}">${info.label}</span></td>
        <td class="fw-bold ${info.sign === '+' ? 'text-success' : 'text-danger'}">${info.sign}${formatCurrency(entry.amount)}</td>
        <td>${escapeHtml(entry.reason || '-')}</td>
        <td>${statusBadge}</td>
        <td>
          <button class="btn btn-sm btn-outline-primary edit-btn" data-id="${entry.id}"><i class="fas fa-edit"></i></button>
          <button class="btn btn-sm btn-outline-danger delete-btn" data-id="${entry.id}"><i class="fas fa-trash"></i></button>
        </td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
  tbody.querySelectorAll('.edit-btn').forEach((b) => b.addEventListener('click', () => openEditModal(b.dataset.id)));
  tbody.querySelectorAll('.delete-btn').forEach((b) => b.addEventListener('click', () => confirmDelete(b.dataset.id)));
}

function updateStats() {
  const approved = entries.filter((e) => e.status === 'approved');
  const earnings = approved.filter((e) => e.type === 'earning').reduce((s, e) => s + (e.amount || 0), 0);
  const bonuses = approved.filter((e) => e.type === 'bonus').reduce((s, e) => s + (e.amount || 0), 0);
  const deductions = approved.filter((e) => e.type === 'deduction').reduce((s, e) => s + (e.amount || 0), 0);
  const payouts = approved.filter((e) => e.type === 'payout').reduce((s, e) => s + (e.amount || 0), 0);
  const payable = earnings + bonuses - deductions - payouts;

  document.getElementById('statEarnings').textContent = formatCurrency(earnings);
  document.getElementById('statBonuses').textContent = formatCurrency(bonuses);
  document.getElementById('statDeductions').textContent = formatCurrency(deductions);
  document.getElementById('statPayouts').textContent = formatCurrency(payouts);
  document.getElementById('statPayable').textContent = formatCurrency(payable);
}

function openAddModal() {
  editingId = null;
  document.getElementById('entryModalTitle').textContent = 'قيد جديد';
  document.getElementById('entryForm').reset();
  document.getElementById('entryId').value = '';
  document.getElementById('entryStatus').value = 'approved';
  if (entryModalInstance) entryModalInstance.show();
}

function openEditModal(id) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) { showToast('القيد غير موجود', 'error'); return; }
  editingId = id;
  document.getElementById('entryModalTitle').textContent = 'تعديل القيد';
  document.getElementById('entryId').value = id;
  document.getElementById('entryEmployee').value = entry.employeeId || '';
  document.getElementById('entryType').value = entry.type || 'earning';
  document.getElementById('entryAmount').value = entry.amount || '';
  document.getElementById('entryReason').value = entry.reason || '';
  document.getElementById('entryTaskId').value = entry.taskId || '';
  document.getElementById('entryOrderId').value = entry.orderId || '';
  document.getElementById('entryStatus').value = entry.status || 'approved';
  if (entryModalInstance) entryModalInstance.show();
}

async function saveEntry() {
  const employeeId = document.getElementById('entryEmployee').value;
  const type = document.getElementById('entryType').value;
  const amount = parseFloat(document.getElementById('entryAmount').value);
  const reason = document.getElementById('entryReason').value.trim();

  if (!employeeId || !type || !amount || amount <= 0 || !reason) {
    showToast('جميع الحقول مطلوبة', 'warning');
    return;
  }

  const emp = employees.find((e) => e.id === employeeId);
  const data = {
    employeeId,
    employeeUid: emp?.uid || null,
    employeeName: emp?.name || null,
    type,
    amount,
    reason,
    taskId: document.getElementById('entryTaskId').value.trim() || null,
    orderId: document.getElementById('entryOrderId').value.trim() || null,
    status: document.getElementById('entryStatus').value,
    approvedBy: auth.currentUser?.uid || null,
    updatedAt: new Date().toISOString(),
  };

  const btn = document.getElementById('saveEntryBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>جاري...';

  try {
    const id = document.getElementById('entryId').value;
    if (id) {
      await updateDoc(doc(db, 'employeeLedger', id), data);
      showToast('تم تحديث القيد', 'success');
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, 'employeeLedger'), data);
      showToast('تم إضافة القيد', 'success');
    }
    if (entryModalInstance) entryModalInstance.hide();
  } catch (error) {
    showToast('تعذّر الحفظ: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save me-2"></i>حفظ';
  }
}

// تسجيل دفعة لموظف (تسديد المستحق)
async function processPayout() {
  const { value: employeeId } = await Swal.fire({
    title: 'تسجيل دفعة لموظف',
    input: 'select',
    inputOptions: Object.fromEntries(employees.map((e) => [e.id, e.name])),
    inputPlaceholder: 'اختر الموظف',
    showCancelButton: true,
    confirmButtonText: 'التالي',
    cancelButtonText: 'إلغاء',
  });

  if (!employeeId) return;

  // حساب المستحق للموظف
  const empEntries = entries.filter((e) => e.employeeId === employeeId && e.status === 'approved');
  const earnings = empEntries.filter((e) => e.type === 'earning').reduce((s, e) => s + (e.amount || 0), 0);
  const bonuses = empEntries.filter((e) => e.type === 'bonus').reduce((s, e) => s + (e.amount || 0), 0);
  const deductions = empEntries.filter((e) => e.type === 'deduction').reduce((s, e) => s + (e.amount || 0), 0);
  const payouts = empEntries.filter((e) => e.type === 'payout').reduce((s, e) => s + (e.amount || 0), 0);
  const payable = earnings + bonuses - deductions - payouts;

  if (payable <= 0) {
    showToast('لا يوجد مستحق لهذا الموظف', 'info');
    return;
  }

  const emp = employees.find((e) => e.id === employeeId);
  const result = await Swal.fire({
    title: `تأكيد الدفعة لـ ${emp.name}`,
    html: `<p>المستحق الحالي: <strong>${formatCurrency(payable)}</strong></p>
           <p>أدخل المبلغ المدفوع:</p>`,
    input: 'number',
    inputValue: payable.toFixed(2),
    inputValidator: (value) => {
      if (!value || parseFloat(value) <= 0) return 'أدخل مبلغًا صحيحًا';
    },
    showCancelButton: true,
    confirmButtonText: 'تأكيد الدفعة',
    cancelButtonText: 'إلغاء',
    confirmButtonColor: '#28a745',
  });

  if (!result.isConfirmed) return;

  const amount = parseFloat(result.value);
  try {
    await addDoc(collection(db, 'employeeLedger'), {
      employeeId,
      employeeUid: emp.uid || null,
      employeeName: emp.name,
      type: 'payout',
      amount,
      reason: `تسديد مستحقات — ${formatCurrency(amount)}`,
      status: 'approved',
      approvedBy: auth.currentUser?.uid,
      createdAt: serverTimestamp(),
      updatedAt: new Date().toISOString(),
    });
    showToast('تم تسجيل الدفعة بنجاح', 'success');
  } catch (error) {
    showToast('تعذّر تسجيل الدفعة', 'error');
  }
}

async function confirmDelete(id) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  const result = await Swal.fire({
    title: 'حذف القيد؟', text: 'سيُحذف نهائيًا.',
    icon: 'warning', showCancelButton: true,
    confirmButtonColor: '#dc3545', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء',
  });
  if (!result.isConfirmed) return;
  try {
    await deleteDoc(doc(db, 'employeeLedger', id));
    showToast('تم الحذف', 'success');
  } catch (e) { showToast('تعذّر الحذف', 'error'); }
}

console.log('✅ employee-ledger.js loaded');
