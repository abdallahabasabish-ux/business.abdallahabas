// =============================================================
// portal-payments.js — مدفوعات العميل + رفع إثبات الدفع
// =============================================================

import { auth, db, storage } from './firebase-config.js';
import {
  onAuthStateChanged, signOut,
} from 'firebase/auth';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, serverTimestamp, getDocs, doc, getDoc,
} from 'firebase/firestore';
import {
  ref, uploadBytes, getDownloadURL,
} from 'firebase/storage';

// =============================================================
// 1. دوال مساعدة
// =============================================================
function formatCurrency(amount, currency = '$') {
  if (amount === undefined || amount === null || isNaN(amount)) return `${currency}0.00`;
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
      text: message, duration: 4000, gravity: 'bottom', position: 'left',
      style: { background: colors[type] || colors.info },
      className: 'rounded-3 shadow',
    }).showToast();
  }
}

function statusBadge(status) {
  const map = {
    'pending': { cls: 'pay-pending', label: 'بانتظار المراجعة' },
    'under_review': { cls: 'pay-under-review', label: 'قيد المراجعة' },
    'approved': { cls: 'pay-approved', label: 'معتمدة' },
    'rejected': { cls: 'pay-rejected', label: 'مرفوضة' },
    'refunded': { cls: 'pay-rejected', label: 'مستردة' },
  };
  const info = map[status] || map['pending'];
  return `<span class="pay-status ${info.cls}">${info.label}</span>`;
}

// =============================================================
// 2. التهيئة
// =============================================================
let currentCustomerUid = null;
let selectedFile = null;
let ordersCache = [];

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'portal-login.html';
    return;
  }

  currentCustomerUid = user.uid;
  document.getElementById('portalLoading').style.display = 'none';
  document.getElementById('portalContent').style.display = 'block';

  // زر الخروج
  document.getElementById('portalLogoutBtn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await signOut(auth);
    window.location.href = 'portal-login.html';
  });

  // تاريخ افتراضي = اليوم
  document.getElementById('paymentDate').value = new Date().toISOString().slice(0, 10);

  // تحميل البيانات
  await loadPaymentMethods();
  await loadOrdersForSelect();
  loadPayments();

  // فحص معامل URL
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('orderId');
  if (orderId) {
    showNewPaymentForm(orderId);
  }

  // أزرار
  document.getElementById('showNewPaymentBtn')?.addEventListener('click', () => showNewPaymentForm());
  document.getElementById('cancelPaymentBtn')?.addEventListener('click', hideNewPaymentForm);
  document.getElementById('paymentForm')?.addEventListener('submit', submitPayment);

  // رفع الملف
  setupFileUpload();
});

// =============================================================
// 3. تحميل طرق الدفع القابلة للتهيئة
// =============================================================
async function loadPaymentMethods() {
  try {
    const snap = await getDocs(collection(db, 'paymentMethods'));
    const methods = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((m) => m.active !== false);

    const select = document.getElementById('method');
    select.innerHTML = '<option value="">اختر طريقة الدفع...</option>';
    methods.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.textContent = m.name;
      select.appendChild(opt);
    });

    // عرض تعليمات الدفع
    const instructionsBody = document.getElementById('instructionsBody');
    if (methods.length === 0) {
      instructionsBody.innerHTML =
        '<p class="text-muted mb-0">لم تُضبط طرق دفع بعد. تواصل مع الإدارة للحصول على بيانات التحويل.</p>';
    } else {
      let html = '';
      methods.forEach((m) => {
        html += `
          <div class="mb-2">
            <strong>${escapeHtml(m.name)}</strong>
            ${m.holder ? `<div>المستفيد: ${escapeHtml(m.holder)}</div>` : ''}
            ${m.identifier ? `<div>المعرّف: ${escapeHtml(m.identifier)}</div>` : ''}
            ${m.instructions ? `<div class="text-muted small">${escapeHtml(m.instructions)}</div>` : ''}
          </div>
        `;
      });
      instructionsBody.innerHTML = html;
    }
  } catch (error) {
    console.warn('Could not load payment methods:', error);
    // fallback: طرق افتراضية مدمجة (للأنظمة بدون paymentMethods)
    const select = document.getElementById('method');
    select.innerHTML = `
      <option value="">اختر طريقة الدفع...</option>
      <option value="تحويل بنكي">تحويل بنكي</option>
      <option value="InstaPay">InstaPay</option>
      <option value="Vodafone Cash">Vodafone Cash</option>
      <option value="cash">كاش</option>
    `;
  }
}

// =============================================================
// 4. تحميل طلبات العميل للقائمة المنسدلة
// =============================================================
async function loadOrdersForSelect() {
  try {
    const q = query(
      collection(db, 'orders'),
      where('customerUid', '==', currentCustomerUid),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    ordersCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.warn('Could not load orders:', error);
    ordersCache = [];
  }
}

// =============================================================
// 5. إظهار/إخفاء نموذج الدفع
// =============================================================
function showNewPaymentForm(orderId = null) {
  document.getElementById('newPaymentCard').style.display = 'block';
  document.getElementById('showNewPaymentBtn').style.display = 'none';
  document.getElementById('newPaymentCard').scrollIntoView({ behavior: 'smooth' });

  if (orderId) {
    // ابحث عن الطلب في الكاش
    const order = ordersCache.find((o) => o.id === orderId);
    if (order) {
      document.getElementById('orderId').value = orderId;
      document.getElementById('orderDisplay').value =
        `#${order.orderNumber || 'N/A'} — ${formatCurrency(order.total || 0)}`;
      const remaining = (order.total || 0) - (order.paid || 0);
      if (remaining > 0) {
        document.getElementById('amount').value = remaining.toFixed(2);
        document.getElementById('amountHint').textContent =
          `المتبقّي على هذا الطلب: ${formatCurrency(remaining)}`;
      }
    }
  }
}

function hideNewPaymentForm() {
  document.getElementById('newPaymentCard').style.display = 'none';
  document.getElementById('showNewPaymentBtn').style.display = '';
  document.getElementById('paymentForm').reset();
  document.getElementById('orderId').value = '';
  document.getElementById('amountHint').textContent = '';
  selectedFile = null;
  resetUploadZone();
  window.history.replaceState({}, document.title, window.location.pathname);
}

// =============================================================
// 6. رفع الملف
// =============================================================
function setupFileUpload() {
  const zone = document.getElementById('uploadZone');
  const input = document.getElementById('receiptFile');

  zone?.addEventListener('click', () => input.click());

  input?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // التحقق من الحجم (5 ميجابايت)
    if (file.size > 5 * 1024 * 1024) {
      showToast('حجم الملف يتجاوز 5 ميجابايت', 'error');
      input.value = '';
      return;
    }

    // التحقق من النوع
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'image/gif', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      showToast('نوع الملف غير مسموح. استخدم صورة أو PDF', 'error');
      input.value = '';
      return;
    }

    selectedFile = file;
    document.getElementById('uploadText').textContent = `✓ ${file.name}`;
    zone.classList.add('has-file');
  });

  // السحب والإفلات
  zone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.style.borderColor = 'var(--color-primary)';
  });

  zone?.addEventListener('dragleave', () => {
    zone.style.borderColor = '';
  });

  zone?.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.style.borderColor = '';
    const file = e.dataTransfer.files[0];
    if (file) {
      input.files = e.dataTransfer.files;
      input.dispatchEvent(new Event('change'));
    }
  });
}

function resetUploadZone() {
  const zone = document.getElementById('uploadZone');
  const input = document.getElementById('receiptFile');
  if (zone) zone.classList.remove('has-file');
  if (input) input.value = '';
  const txt = document.getElementById('uploadText');
  if (txt) txt.textContent = 'اضغط لاختيار ملف الإثبات';
}

// =============================================================
// 7. إرسال الدفعة
// =============================================================
async function submitPayment(e) {
  e.preventDefault();

  const orderId = document.getElementById('orderId').value;
  const amount = parseFloat(document.getElementById('amount').value);
  const method = document.getElementById('method').value;
  const paymentDate = document.getElementById('paymentDate').value;
  const notes = document.getElementById('notes').value.trim();

  if (!amount || amount <= 0) {
    showToast('أدخل مبلغًا صحيحًا', 'warning');
    return;
  }

  if (!method) {
    showToast('اختر طريقة الدفع', 'warning');
    return;
  }

  if (!paymentDate) {
    showToast('اختر تاريخ التحويل', 'warning');
    return;
  }

  const btn = document.getElementById('submitPaymentBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>جاري الإرسال...';

  try {
    let receiptUrl = null;

    // رفع الإثبات إن وُجد
    if (selectedFile) {
      showToast('جاري رفع الإثبات...', 'info');
      const path = `receipts/${currentCustomerUid}/${Date.now()}_${selectedFile.name}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, selectedFile);
      receiptUrl = await getDownloadURL(storageRef);
    }

    // إنشاء وثيقة الدفعة بحالة pending
    // القواعد تسمح للعميل بإنشاء دفعة فقط إذا status == "pending"
    const paymentData = {
      customerUid: currentCustomerUid,
      customerId: currentCustomerUid,
      orderId: orderId || null,
      amount,
      method,
      paymentDate: new Date(paymentDate + 'T00:00:00'),
      notes,
      receiptUrl,
      status: 'pending',
      verificationStatus: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      source: 'portal',
    };

    await addDoc(collection(db, 'payments'), paymentData);

    showToast('تم إرسال إثبات الدفع بنجاح! ستتم مراجعته من قبل الإدارة.', 'success');
    hideNewPaymentForm();
  } catch (error) {
    console.error('Payment submission error:', error);
    let msg = 'تعذّر إرسال الدفعة.';
    if (error.code === 'permission-denied') {
      msg = 'ليس لديك صلاحية إرسال دفعة. تواصل مع الإدارة.';
    } else if (error.code === 'storage/unauthorized') {
      msg = 'تعذّر رفع الملف. تحقق من النوع والحجم.';
    }
    showToast(msg, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane me-2"></i>إرسال إثبات الدفع';
  }
}

// =============================================================
// 8. تحميل سجل المدفوعات (Realtime)
// =============================================================
function loadPayments() {
  const q = query(
    collection(db, 'payments'),
    where('customerUid', '==', currentCustomerUid),
    orderBy('createdAt', 'desc')
  );

  onSnapshot(q, (snapshot) => {
    const payments = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderPayments(payments);
  }, (error) => {
    console.warn('Could not load payments:', error);
    document.getElementById('paymentsList').innerHTML =
      '<p class="text-muted text-center py-3">لا توجد مدفوعات بعد</p>';
  });
}

function renderPayments(payments) {
  const container = document.getElementById('paymentsList');

  if (!payments || payments.length === 0) {
    container.innerHTML = `
      <div class="payment-card text-center">
        <i class="fas fa-receipt fa-3x text-muted mb-3"></i>
        <h5 class="text-muted">لا توجد مدفوعات بعد</h5>
        <p class="text-muted">ارفع إثبات دفعتك الأولى ليبدأ السجل</p>
      </div>
    `;
    return;
  }

  let html = '';
  for (const p of payments) {
    const order = ordersCache.find((o) => o.id === p.orderId);
    const orderDisplay = order
      ? `#${order.orderNumber || 'N/A'}`
      : (p.orderId ? 'طلب مرتبط' : 'دفعة عامة');

    html += `
      <div class="payment-card">
        <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
          <div>
            <strong style="font-size:18px;">${formatCurrency(p.amount)}</strong>
            ${statusBadge(p.status)}
            <div class="text-muted small mt-1">
              <i class="fas fa-box me-1"></i>${escapeHtml(orderDisplay)}
              <span class="mx-2">•</span>
              <i class="fas fa-credit-card me-1"></i>${escapeHtml(p.method || '-')}
              <span class="mx-2">•</span>
              <i class="fas fa-calendar me-1"></i>${formatDate(p.paymentDate)}
            </div>
            ${p.notes ? `<div class="text-muted small mt-1">ملاحظات: ${escapeHtml(p.notes)}</div>` : ''}
            ${p.receiptUrl ? `<a href="${p.receiptUrl}" target="_blank" class="btn btn-sm btn-outline-primary mt-2"><i class="fas fa-file me-1"></i>عرض الإثبات</a>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

console.log('✅ portal-payments.js loaded');
