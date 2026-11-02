// =============================================================
// payments.js — النسخة النهائية مع التكامل الكامل
// =============================================================
// هذه نسخة جاهزة من payments.js تتضمن:
// - سير التحقق من المدفوعات (pending → approved/rejected)
// - معاملة ذرية للخزينة عند الاعتماد
// - تسجيل النشاطات في activityLogs
// - إشعارات تلقائية للعميل
// 
// استبدل ملف payments.js الحالي بهذا الملف.
// =============================================================

import { onAuthStateChangedCallback, logoutUser } from '../auth.js';
import { auth, db } from '../firebase-config.js';
import {
  collection, addDoc, doc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, getDocs, runTransaction,
  serverTimestamp, where,
} from 'firebase/firestore';
import { initPage, formatCurrency, formatDate, escapeHtml, showToast } from '../init.js';
import { getCurrentUid, getUserData } from '../permissions.js';
import { log } from '../activity-log-helper.js';
import { createNotification } from '../notification-helper.js';

let payments = [];
let customersList = [];
let editingId = null;
let paymentsListener = null;
let paymentModalInstance = null;

// =============================================================
// 1. التهيئة
// =============================================================
initPage({
  onReady: async () => {
    await loadCustomers();
    listenToPayments();
    document.addEventListener('click', handleActionButtonClick);
  },
});

// =============================================================
// 2. تحميل العملاء
// =============================================================
async function loadCustomers() {
  try {
    const snap = await getDocs(collection(db, 'customers'));
    customersList = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    populateCustomerSelect();
  } catch (error) {
    console.error('Error loading customers:', error);
  }
}

function populateCustomerSelect() {
  const select = document.getElementById('customerSelect');
  if (!select) return;
  select.innerHTML = '<option value="">اختر عميل...</option>';
  customersList.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    opt.dataset.uid = c.uid || '';
    select.appendChild(opt);
  });
}

// =============================================================
// 3. الاستماع للمدفوعات
// =============================================================
function listenToPayments() {
  const q = query(collection(db, 'payments'), orderBy('paymentDate', 'desc'));
  if (paymentsListener) paymentsListener();

  paymentsListener = onSnapshot(q, (snapshot) => {
    payments = snapshot.docs.map((d) => ({
      id: d.id, ...d.data(),
      paymentDate: d.data().paymentDate?.toDate?.() || d.data().paymentDate || null,
    }));

    // الإجمالي = المعتمدة فقط (للدقة المالية)
    const approvedTotal = payments
      .filter((p) => !p.status || p.status === 'approved')
      .reduce((sum, p) => sum + (p.amount || 0), 0);
    const totalEl = document.getElementById('totalPayments');
    if (totalEl) totalEl.textContent = formatCurrency(approvedTotal);

    const searchTerm = document.getElementById('searchInput')?.value.trim().toLowerCase() || '';
    const filtered = searchTerm ? filterPayments(searchTerm) : payments;
    renderTable(filtered);
  }, (error) => {
    console.error('Error:', error);
    showToast('حدث خطأ في تحميل المدفوعات', 'error');
  });
}

// =============================================================
// 4. عرض الجدول
// =============================================================
function renderTable(data) {
  const tbody = document.getElementById('paymentsTableBody');
  if (!tbody) return;

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">لا يوجد مدفوعات</td></tr>`;
    return;
  }

  let html = '';
  data.forEach((payment, index) => {
    let customerName = payment.customerName || 'غير معروف';
    if (!payment.customerName) {
      const customer = customersList.find((c) => c.id === payment.customerId);
      customerName = customer ? customer.name : 'غير معروف';
    }
    const status = payment.status || 'approved';
    const statusBadge = getStatusBadge(status);

    html += `
      <tr>
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(customerName)}</strong></td>
        <td class="payment-amount">${formatCurrency(payment.amount)}</td>
        <td><span class="payment-method-badge">${escapeHtml(payment.method || '')}</span></td>
        <td>${formatDate(payment.paymentDate)}</td>
        <td>${statusBadge}</td>
        <td>${escapeHtml(payment.notes || '')}</td>
        <td>
          ${status === 'pending' ? `
            <button class="btn btn-sm btn-outline-success action-btn" data-action="approve" data-id="${payment.id}" title="اعتماد">
              <i class="fas fa-check"></i>
            </button>
            <button class="btn btn-sm btn-outline-danger action-btn" data-action="reject" data-id="${payment.id}" title="رفض">
              <i class="fas fa-times"></i>
            </button>
          ` : ''}
          <button class="btn btn-sm btn-outline-primary action-btn" data-action="edit" data-id="${payment.id}" title="تعديل">
            <i class="fas fa-edit"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger action-btn" data-action="delete" data-id="${payment.id}" title="حذف">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

function getStatusBadge(status) {
  const map = {
    pending: '<span class="badge bg-warning text-dark">بانتظار المراجعة</span>',
    under_review: '<span class="badge bg-info text-dark">قيد المراجعة</span>',
    approved: '<span class="badge bg-success">معتمدة</span>',
    rejected: '<span class="badge bg-danger">مرفوضة</span>',
    refunded: '<span class="badge bg-secondary">مستردة</span>',
  };
  return map[status] || '<span class="badge bg-success">معتمدة</span>';
}

// =============================================================
// 5. معالجة الأزرار
// =============================================================
function handleActionButtonClick(e) {
  const btn = e.target.closest('.action-btn');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  if (!action || !id) return;
  e.preventDefault();

  if (action === 'edit') openEditModal(id);
  else if (action === 'delete') confirmDelete(id);
  else if (action === 'approve') approvePayment(id);
  else if (action === 'reject') rejectPayment(id);
}

// =============================================================
// 6. اعتماد دفعة — معاملة ذرية + تسجيل + إشعار
// =============================================================
async function approvePayment(id) {
  const payment = payments.find((p) => p.id === id);
  if (!payment) return;

  const result = await Swal.fire({
    title: 'اعتماد الدفعة؟',
    text: `سيتم اعتماد دفعة بقيمة ${formatCurrency(payment.amount)} من ${payment.customerName || 'العميل'}.`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'نعم، اعتمد',
    cancelButtonText: 'إلغاء',
    confirmButtonColor: '#28a745',
  });

  if (!result.isConfirmed) return;

  try {
    // 1. معاملة ذرية: تحديث الدفعة + رصيد العميل + إيداع خزينة
    await runTransaction(db, async (transaction) => {
      const paymentRef = doc(db, 'payments', id);
      transaction.update(paymentRef, {
        status: 'approved',
        verificationStatus: 'approved',
        verifiedAt: new Date().toISOString(),
        verifiedBy: getCurrentUid(),
        updatedAt: new Date().toISOString(),
      });

      if (payment.customerId) {
        const customerRef = doc(db, 'customers', payment.customerId);
        const customerDoc = await transaction.get(customerRef);
        if (customerDoc.exists()) {
          const data = customerDoc.data();
          transaction.update(customerRef, {
            totalPaid: (data.totalPaid || 0) + (payment.amount || 0),
            balance: (data.balance || 0) - (payment.amount || 0),
            updatedAt: new Date().toISOString(),
          });
        }
      }

      const treasuryRef = doc(collection(db, 'treasury'));
      transaction.set(treasuryRef, {
        type: 'deposit',
        amount: payment.amount,
        source: 'payments',
        sourceTransactionId: id,
        customerId: payment.customerId || null,
        customerUid: payment.customerUid || null,
        customerName: payment.customerName || null,
        title: `إيداع من اعتماد دفعة - ${payment.customerName || 'عميل'}`,
        note: `مرتبط بالدفعة ${id.substring(0, 8)}`,
        date: new Date(),
        createdAt: serverTimestamp(),
        updatedAt: new Date().toISOString(),
      });
    });

    // 2. تسجيل النشاط
    await log.paymentApproved(id, payment.amount, payment.customerName || 'العميل');

    // 3. إشعار العميل
    if (payment.customerUid) {
      await createNotification(
        payment.customerUid,
        'payment_approved',
        'تم اعتماد دفعتك',
        `تم اعتماد دفعتك بقيمة ${formatCurrency(payment.amount)}. شكرًا لك.`,
        id
      );
    }

    showToast('تم اعتماد الدفعة وتحديث الأرصدة بنجاح', 'success');
  } catch (error) {
    console.error('Error approving payment:', error);
    showToast('تعذّر اعتماد الدفعة: ' + error.message, 'error');
  }
}

// =============================================================
// 7. رفض دفعة — مع تسجيل + إشعار
// =============================================================
async function rejectPayment(id) {
  const payment = payments.find((p) => p.id === id);
  if (!payment) return;

  const result = await Swal.fire({
    title: 'رفض الدفعة؟',
    text: `سيتم رفض دفعة بقيمة ${formatCurrency(payment.amount)}. لن يتأثر رصيد العميل.`,
    icon: 'warning',
    input: 'textarea',
    inputPlaceholder: 'سبب الرفض (اختياري)',
    showCancelButton: true,
    confirmButtonText: 'نعم، ارفض',
    cancelButtonText: 'إلغاء',
    confirmButtonColor: '#dc3545',
  });

  if (!result.isConfirmed) return;

  try {
    await updateDoc(doc(db, 'payments', id), {
      status: 'rejected',
      verificationStatus: 'rejected',
      rejectionReason: result.value || '',
      verifiedAt: new Date().toISOString(),
      verifiedBy: getCurrentUid(),
      updatedAt: new Date().toISOString(),
    });

    // تسجيل النشاط
    await log.paymentRejected(id, payment.amount, payment.customerName || 'العميل');

    // إشعار العميل
    if (payment.customerUid) {
      await createNotification(
        payment.customerUid,
        'payment_rejected',
        'تم رفض دفعتك',
        `لم يتم اعتماد دفعتك بقيمة ${formatCurrency(payment.amount)}. ${result.value ? 'السبب: ' + result.value : ''}`,
        id
      );
    }

    showToast('تم رفض الدفعة', 'success');
  } catch (error) {
    console.error('Error rejecting payment:', error);
    showToast('تعذّر رفض الدفعة', 'error');
  }
}

// =============================================================
// 8. فتح مودال الإضافة
// =============================================================
document.getElementById('addPaymentBtn')?.addEventListener('click', () => {
  editingId = null;
  document.getElementById('modalTitle').textContent = 'تسجيل دفعة جديدة';
  document.getElementById('paymentForm').reset();
  document.getElementById('paymentId').value = '';
  document.getElementById('oldAmount').value = '';
  if (typeof flatpickr !== 'undefined') {
    flatpickr('#paymentDate', {
      locale: 'ar', dateFormat: 'Y-m-d',
      defaultDate: new Date().toISOString().slice(0, 10),
    });
  }
  populateCustomerSelect();
  if (paymentModalInstance) paymentModalInstance.show();
});

// =============================================================
// 9. مودال التعديل
// =============================================================
function openEditModal(id) {
  const payment = payments.find((p) => p.id === id);
  if (!payment) {
    showToast('الدفعة غير موجودة', 'error');
    return;
  }
  editingId = id;
  document.getElementById('modalTitle').textContent = 'تعديل الدفعة';
  document.getElementById('paymentId').value = id;
  document.getElementById('amount').value = payment.amount || '';
  document.getElementById('oldAmount').value = payment.amount || 0;
  document.getElementById('method').value = payment.method || '';
  document.getElementById('paymentDate').value = formatDate(payment.paymentDate);
  document.getElementById('paymentNotes').value = payment.notes || '';
  populateCustomerSelect();
  const customer = customersList.find((c) => c.id === payment.customerId);
  if (customer) document.getElementById('customerSelect').value = customer.id;
  if (typeof flatpickr !== 'undefined') {
    flatpickr('#paymentDate', { locale: 'ar', dateFormat: 'Y-m-d', defaultDate: payment.paymentDate || new Date() });
  }
  if (paymentModalInstance) paymentModalInstance.show();
}

// =============================================================
// 10. حفظ الدفعة
// =============================================================
document.getElementById('savePaymentBtn')?.addEventListener('click', async () => {
  const customerId = document.getElementById('customerSelect').value;
  const amount = parseFloat(document.getElementById('amount').value);
  const method = document.getElementById('method').value;
  if (!customerId || !amount || amount <= 0 || !method) {
    showToast('الرجاء اختيار العميل والمبلغ وطريقة الدفع', 'warning');
    return;
  }

  const paymentId = document.getElementById('paymentId').value;
  const oldAmount = parseFloat(document.getElementById('oldAmount').value) || 0;
  const paymentDate = document.getElementById('paymentDate').value || new Date().toISOString().slice(0, 10);
  const notes = document.getElementById('paymentNotes').value.trim();

  const selectedOption = document.getElementById('customerSelect').selectedOptions[0];
  const customerUid = selectedOption?.dataset.uid || null;

  const saveBtn = document.getElementById('savePaymentBtn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>جاري الحفظ...';

  try {
    await runTransaction(db, async (transaction) => {
      const customerRef = doc(db, 'customers', customerId);
      const customerDoc = await transaction.get(customerRef);
      if (!customerDoc.exists()) throw new Error('العميل غير موجود');
      const customerData = customerDoc.data();

      let currentTotalPaid = customerData.totalPaid || 0;
      let currentBalance = customerData.balance || 0;
      if (paymentId) {
        currentTotalPaid = currentTotalPaid - oldAmount + amount;
        currentBalance = currentBalance + oldAmount - amount;
      } else {
        currentTotalPaid += amount;
        currentBalance -= amount;
      }

      transaction.update(customerRef, {
        totalPaid: currentTotalPaid, balance: currentBalance,
        updatedAt: new Date().toISOString(),
      });

      const paymentData = {
        customerId,
        customerUid: customerUid || customerData.uid || null,
        customerName: customerData.name || null,
        amount, method,
        paymentDate: paymentDate ? new Date(paymentDate + 'T00:00:00') : serverTimestamp(),
        notes,
        updatedAt: new Date().toISOString(),
        source: 'admin',
      };

      if (!paymentId) {
        paymentData.status = 'approved';
        paymentData.verificationStatus = 'approved';
        paymentData.verifiedAt = new Date().toISOString();
        paymentData.verifiedBy = getCurrentUid();
        paymentData.createdAt = new Date().toISOString();
      }

      if (paymentId) {
        transaction.update(doc(db, 'payments', paymentId), paymentData);
      } else {
        const paymentRef = doc(collection(db, 'payments'));
        transaction.set(paymentRef, paymentData);
      }
    });

    // تسجيل النشاط
    if (!paymentId) {
      await log.paymentCreated(null, amount, customersList.find(c => c.id === customerId)?.name || 'العميل');
    }

    showToast(paymentId ? 'تم تحديث الدفعة' : 'تم تسجيل الدفعة', 'success');
    if (paymentModalInstance) paymentModalInstance.hide();
  } catch (error) {
    console.error('Error:', error);
    showToast('حدث خطأ أثناء الحفظ', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i class="fas fa-save me-2"></i>حفظ';
  }
});

// =============================================================
// 11. حذف دفعة
// =============================================================
async function confirmDelete(id) {
  const payment = payments.find((p) => p.id === id);
  if (!payment) return;

  const result = await Swal.fire({
    title: 'حذف الدفعة؟',
    text: `سيتم حذف دفعة بقيمة ${formatCurrency(payment.amount)}. سيُعاد تحديث رصيد العميل.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    confirmButtonText: 'نعم، احذف',
    cancelButtonText: 'إلغاء',
  });

  if (!result.isConfirmed) return;

  try {
    await runTransaction(db, async (transaction) => {
      transaction.delete(doc(db, 'payments', id));
      if (payment.customerId) {
        const customerRef = doc(db, 'customers', payment.customerId);
        const customerDoc = await transaction.get(customerRef);
        if (customerDoc.exists()) {
          const data = customerDoc.data();
          transaction.update(customerRef, {
            totalPaid: (data.totalPaid || 0) - (payment.amount || 0),
            balance: (data.balance || 0) + (payment.amount || 0),
            updatedAt: new Date().toISOString(),
          });
        }
      }
    });

    showToast('تم حذف الدفعة', 'success');
  } catch (error) {
    showToast('تعذّر الحذف', 'error');
  }
}

// =============================================================
// 12. البحث
// =============================================================
function filterPayments(term) {
  return payments.filter((p) => {
    let name = p.customerName || '';
    if (!p.customerName) {
      const c = customersList.find((c) => c.id === p.customerId);
      name = c ? c.name : '';
    }
    return name.toLowerCase().includes(term);
  });
}

document.getElementById('searchInput')?.addEventListener('input', (e) => {
  const term = e.target.value.trim().toLowerCase();
  const filtered = term ? filterPayments(term) : payments;
  renderTable(filtered);
});

// =============================================================
// 13. المودال
// =============================================================
const modalEl = document.getElementById('paymentModal');
if (modalEl) {
  paymentModalInstance = new bootstrap.Modal(modalEl);
  modalEl.addEventListener('hidden.bs.modal', () => {
    document.getElementById('paymentForm').reset();
    document.getElementById('paymentId').value = '';
    document.getElementById('oldAmount').value = '';
  });
}

console.log('✅ payments.js loaded (final version with full integration)');
