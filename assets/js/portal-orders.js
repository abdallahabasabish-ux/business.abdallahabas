// =============================================================
// portal-orders.js — مُحدَّث لعرض تتبع المهام (milestones مرئية للعميل)
// =============================================================
// التغيير: عرض المراحل المرئية للعميل فقط (customerVisible == true)
// بدلاً من عرض كل المراحل الداخلية
// =============================================================

import { auth, db } from '../firebase-config.js';
import {
  onAuthStateChanged, signOut,
} from 'firebase/auth';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, serverTimestamp, getDocs,
} from 'firebase/firestore';

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
      text: message, duration: 3500, gravity: 'bottom', position: 'left',
      style: { background: colors[type] || colors.info },
      className: 'rounded-3 shadow',
    }).showToast();
  }
}

function statusBadge(status) {
  const map = {
    'جديد': 'status-new', 'قيد التنفيذ': 'status-progress',
    'مكتمل': 'status-complete', 'ملغي': 'status-cancelled',
  };
  const cls = map[status] || 'status-new';
  return `<span class="order-status-badge ${cls}">${escapeHtml(status || 'جديد')}</span>`;
}

let currentCustomerUid = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'portal-login.html';
    return;
  }

  currentCustomerUid = user.uid;
  document.getElementById('portalLoading').style.display = 'none';
  document.getElementById('portalContent').style.display = 'block';

  document.getElementById('portalLogoutBtn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await signOut(auth);
    window.location.href = 'portal-login.html';
  });

  const params = new URLSearchParams(window.location.search);
  if (params.get('action') === 'new') {
    showNewOrderForm();
  }

  document.getElementById('showNewOrderBtn')?.addEventListener('click', showNewOrderForm);
  document.getElementById('cancelNewOrderBtn')?.addEventListener('click', hideNewOrderForm);

  await loadServices();
  loadOrders();
  document.getElementById('newOrderForm')?.addEventListener('submit', submitNewOrder);
});

async function loadServices() {
  try {
    const snap = await getDocs(collection(db, 'services'));
    const select = document.getElementById('serviceSelect');
    if (!select) return;

    select.innerHTML = '<option value="">اختر خدمة...</option>';
    snap.docs.forEach((docSnap) => {
      const svc = docSnap.data();
      if (svc.status === 'نشط') {
        const opt = document.createElement('option');
        opt.value = docSnap.id;
        opt.textContent = `${svc.name} — ${formatCurrency(svc.price)}`;
        select.appendChild(opt);
      }
    });
  } catch (error) {
    console.warn('Could not load services:', error);
  }
}

function showNewOrderForm() {
  document.getElementById('newRequestCard').style.display = 'block';
  document.getElementById('showNewOrderBtn').style.display = 'none';
  document.getElementById('newRequestCard').scrollIntoView({ behavior: 'smooth' });
}

function hideNewOrderForm() {
  document.getElementById('newRequestCard').style.display = 'none';
  document.getElementById('showNewOrderBtn').style.display = '';
  window.history.replaceState({}, document.title, window.location.pathname);
}

async function submitNewOrder(e) {
  e.preventDefault();

  const serviceId = document.getElementById('serviceSelect').value;
  const description = document.getElementById('orderDescription').value.trim();
  const expectedDate = document.getElementById('expectedDate').value;

  if (!serviceId || !description) {
    showToast('يرجى اختيار خدمة ووصف الطلب', 'warning');
    return;
  }

  const btn = document.getElementById('submitOrderBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>جاري الإرسال...';

  try {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const orderNumber = `PORTAL-${dateStr}-${Math.floor(Math.random() * 9000 + 1000)}`;

    await addDoc(collection(db, 'orders'), {
      orderNumber,
      customerUid: currentCustomerUid,
      customerId: currentCustomerUid,
      serviceId,
      description,
      price: 0,
      discount: 0,
      tax: 0,
      total: 0,
      paid: 0,
      status: 'جديد',
      priority: 'متوسطة',
      notes: description,
      stages: [],
      completionRate: 0,
      deadline: expectedDate || null,
      expectedDeliveryDate: expectedDate || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lifecycleStage: 'inquiry',
      approvalStatus: 'pending',
      source: 'portal',
    });

    showToast('تم إرسال طلبك بنجاح! سيتواصل معك فريقنا قريبًا.', 'success');
    hideNewOrderForm();
    document.getElementById('newOrderForm').reset();
  } catch (error) {
    console.error('Error creating order:', error);
    let msg = 'تعذّر إرسال الطلب.';
    if (error.code === 'permission-denied') {
      msg = 'ليس لديك صلاحية إرسال طلب.';
    }
    showToast(msg, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane me-2"></i>إرسال الطلب';
  }
}

function loadOrders() {
  const q = query(
    collection(db, 'orders'),
    where('customerUid', '==', currentCustomerUid),
    orderBy('createdAt', 'desc')
  );

  onSnapshot(q, (snapshot) => {
    const orders = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    renderOrders(orders);
  }, (error) => {
    console.warn('Could not load orders:', error);
    document.getElementById('ordersList').innerHTML =
      '<p class="text-muted text-center py-3">لا توجد طلبات بعد</p>';
  });
}

function renderOrders(orders) {
  const container = document.getElementById('ordersList');

  if (!orders || orders.length === 0) {
    container.innerHTML = `
      <div class="order-card text-center">
        <i class="fas fa-inbox fa-3x text-muted mb-3"></i>
        <h5 class="text-muted">لا توجد طلبات بعد</h5>
        <p class="text-muted">أرسل طلب خدمة جديد للبدء</p>
        <button class="btn btn-primary" onclick="document.getElementById('showNewOrderBtn').click()">
          <i class="fas fa-plus me-2"></i>طلب خدمة جديدة
        </button>
      </div>
    `;
    return;
  }

  let html = '';
  for (const order of orders) {
    const total = order.total || 0;
    const paid = order.paid || 0;
    const remaining = total - paid;
    const completionRate = order.completionRate || 0;

    // عرض المراحل المرئية للعميل فقط
    const visibleStages = (order.stages || []).filter((s) => s.customerVisible);
    const visibleDone = visibleStages.filter((s) => s.completed).length;

    let stagesHtml = '';
    if (visibleStages.length > 0) {
      stagesHtml = `
        <div class="progress-tracker">
          ${visibleStages.map((s) =>
            `<div class="progress-step ${s.completed ? 'done' : ''}" title="${escapeHtml(s.stage)}"></div>`
          ).join('')}
        </div>
        <small class="text-muted">${visibleDone}/${visibleStages.length} مرحلة مكتملة</small>
      `;
    } else if (order.stages && order.stages.length > 0) {
      // إذا لم تكن هناك مراحل مرئية، اعرض شريط تقدّم عام
      stagesHtml = `
        <small class="text-muted"><i class="fas fa-info-circle"></i> العمل قيد التنفيذ الداخلي</small>
      `;
    }

    const approvalBadge = order.approvalStatus === 'pending'
      ? '<span class="badge bg-warning text-dark ms-1">بانتظار المراجعة</span>'
      : order.approvalStatus === 'approved'
        ? '<span class="badge bg-success ms-1">معتمد</span>'
        : order.approvalStatus === 'rejected'
          ? '<span class="badge bg-danger ms-1">مرفوض</span>'
          : '';

    html += `
      <div class="order-card">
        <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
          <div>
            <strong style="font-size:18px;">#${escapeHtml(order.orderNumber || 'N/A')}</strong>
            ${statusBadge(order.status)}
            ${approvalBadge}
            ${order.source === 'portal' ? '<span class="badge bg-info ms-1">بوابتك</span>' : ''}
            <div class="text-muted small mt-1">${formatDate(order.createdAt)}</div>
          </div>
          <div class="text-end">
            <div class="fw-bold" style="font-size:18px;">${formatCurrency(total)}</div>
            ${remaining > 0
              ? `<div class="text-danger small">متبقّي: ${formatCurrency(remaining)}</div>
                 <a href="portal-payments.html?orderId=${order.id}" class="btn btn-sm btn-primary mt-1">
                   <i class="fas fa-upload me-1"></i>رفع دفعة
                 </a>`
              : total > 0
                ? '<div class="text-success small"><i class="fas fa-check"></i> مدفوع بالكامل</div>'
                : '<div class="text-muted small">السعر يُحدّد لاحقًا</div>'}
          </div>
        </div>

        ${order.description || order.notes
          ? `<div class="mt-3 text-muted">${escapeHtml(order.description || order.notes)}</div>`
          : ''}

        ${stagesHtml}

        ${completionRate > 0
          ? `<div class="mt-2">
              <div class="d-flex justify-content-between small text-muted mb-1">
                <span>نسبة الإنجاز الإجمالية</span><span>${completionRate}%</span>
              </div>
              <div class="progress" style="height:6px;">
                <div class="progress-bar bg-primary" style="width:${completionRate}%"></div>
              </div>
            </div>`
          : ''}
      </div>
    `;
  }

  container.innerHTML = html;
}

console.log('✅ portal-orders.js loaded (updated with customer-visible milestones)');
