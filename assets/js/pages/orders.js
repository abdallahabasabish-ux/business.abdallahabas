// =============================================================
// orders.js — مُحدَّث مع دورة حياة كاملة + تعيين متعدد + موافقات
// =============================================================
// التغييرات:
// 1. تعيين عدة موظفين (assignedEmployeeIds[]) مع الاحتفاظ بـ employeeId
// 2. دورة حياة: inquiry → pending → approved → in_progress → under_review → completed → cancelled
// 3. موافقة الطلب قبل بدء العمل
// 4. مراحل قابلة للرؤية للعميل (customerVisible)
// 5. حقول جديدة: lifecycleStage, approvalStatus, actualDeliveryDate
// =============================================================

import { db } from '../firebase-config.js';
import {
  collection, addDoc, doc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, getDocs, where, serverTimestamp,
} from 'firebase/firestore';
import {
  initPage, formatCurrency, formatDate, escapeHtml, showToast,
} from '../init.js';
import { initDynamicSidebar } from '../sidebar.js';
import { isAdmin, hasPermission, getCurrentUid, getUserData } from '../permissions.js';

let orders = [];
let editingId = null;
let ordersListener = null;
let customersList = [];
let servicesList = [];
let employeesList = [];
let orderModalInstance = null;

const STAGES = [
  { name: 'استلام', customerVisible: true },
  { name: 'مراجعة', customerVisible: false },
  { name: 'تصميم', customerVisible: true },
  { name: 'تطوير', customerVisible: true },
  { name: 'اختبار', customerVisible: false },
  { name: 'مراجعة نهائية', customerVisible: false },
  { name: 'تسليم', customerVisible: true },
  { name: 'إغلاق', customerVisible: false },
];

// =============================================================
// 1. التهيئة
// =============================================================
initPage({
  onReady: async () => {
    initDynamicSidebar();
    await loadSelectOptions();
    listenToOrders();

    document.getElementById('addOrderBtn')?.addEventListener('click', openAddModal);
    document.getElementById('saveOrderBtn')?.addEventListener('click', saveOrder);
    document.getElementById('searchInput')?.addEventListener('input', handleSearch);

    const modalEl = document.getElementById('orderModal');
    if (modalEl) {
      orderModalInstance = new bootstrap.Modal(modalEl, { backdrop: 'static' });
      modalEl.addEventListener('hidden.bs.modal', () => {
        document.getElementById('orderForm').reset();
        document.getElementById('orderId').value = '';
      });
    }
  },
});

// =============================================================
// 2. تحميل القوائم المنسدلة
// =============================================================
async function loadSelectOptions() {
  try {
    const [customersSnap, servicesSnap, employeesSnap] = await Promise.all([
      getDocs(collection(db, 'customers')),
      getDocs(collection(db, 'services')),
      getDocs(query(collection(db, 'employees'), where('status', '==', 'نشط'))),
    ]);

    customersList = customersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    servicesList = servicesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    employeesList = employeesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    populateSelects();
  } catch (error) {
    console.error('Error loading select options:', error);
    showToast('حدث خطأ في تحميل البيانات', 'error');
  }
}

function populateSelects() {
  const customerSelect = document.getElementById('customer');
  const serviceSelect = document.getElementById('service');

  if (customerSelect) {
    customerSelect.innerHTML = '<option value="">اختر عميل...</option>';
    customersList.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      opt.dataset.uid = c.uid || '';
      customerSelect.appendChild(opt);
    });
  }

  if (serviceSelect) {
    serviceSelect.innerHTML = '<option value="">اختر خدمة...</option>';
    servicesList.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name} ($${s.price})`;
      opt.dataset.price = s.price;
      serviceSelect.appendChild(opt);
    });
  }
}

// =============================================================
// 3. الاستماع للطلبات
// =============================================================
function listenToOrders() {
  const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
  if (ordersListener) ordersListener();

  ordersListener = onSnapshot(q, (snapshot) => {
    if (snapshot.empty) {
      orders = [];
      renderTable([]);
      const rc = document.getElementById('resultCount');
      if (rc) rc.textContent = 'عرض 0 طلب';
      return;
    }

    orders = snapshot.docs.map((d) => ({
      id: d.id,
      ...d.data(),
      deadline: d.data().deadline?.toDate?.() || d.data().deadline || null,
      createdAt: d.data().createdAt?.toDate?.() || d.data().createdAt || null,
    }));

    const searchTerm = document.getElementById('searchInput')?.value.trim().toLowerCase() || '';
    const filtered = searchTerm ? filterOrders(searchTerm) : orders;
    renderTable(filtered);
    const rc = document.getElementById('resultCount');
    if (rc) rc.textContent = `عرض ${filtered.length} طلب`;
  }, (error) => {
    console.error('Error listening to orders:', error);
    showToast('حدث خطأ في تحميل الطلبات', 'error');
  });
}

// =============================================================
// 4. عرض الجدول
// =============================================================
function renderTable(data) {
  const tbody = document.getElementById('ordersTableBody');
  if (!tbody) return;

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center text-muted py-4">لا يوجد طلبات</td></tr>`;
    return;
  }

  let html = '';
  data.forEach((order) => {
    const customer = customersList.find((c) => c.id === order.customerId);
    const service = servicesList.find((s) => s.id === order.serviceId);

    // عرض الحالة مع شارة الموافقة
    const statusClass = {
      'جديد': 'badge bg-info text-dark',
      'قيد التنفيذ': 'badge bg-warning text-dark',
      'مكتمل': 'badge bg-success',
      'ملغي': 'badge bg-danger',
    }[order.status] || 'badge bg-secondary';

    const approvalBadge = order.approvalStatus === 'approved'
      ? '<span class="badge bg-success ms-1">معتمد</span>'
      : order.approvalStatus === 'pending'
        ? '<span class="badge bg-warning text-dark ms-1">بانتظار الموافقة</span>'
        : order.approvalStatus === 'rejected'
          ? '<span class="badge bg-danger ms-1">مرفوض</span>'
          : '<span class="badge bg-secondary ms-1">—</span>';

    const priorityClass = {
      'عالية': 'text-danger', 'متوسطة': 'text-warning', 'منخفضة': 'text-success',
    }[order.priority] || '';

    const completionRate = order.completionRate || 0;
    const total = order.total || 0;
    const paid = order.paid || 0;
    const remaining = total - paid;

    // عرض الموظفين المسندين
    const assignedNames = (order.assignedEmployeeIds || []).map((uid) => {
      const emp = employeesList.find((e) => (e.uid || e.id) === uid);
      return emp ? emp.name : null;
    }).filter(Boolean);
    const employeeDisplay = assignedNames.length > 0
      ? assignedNames.join(', ')
      : (order.employeeId ? (employeesList.find((e) => e.id === order.employeeId)?.name || 'غير معروف') : 'غير معيّن');

    html += `
      <tr>
        <td><strong>#${order.orderNumber || 'N/A'}</strong></td>
        <td>${customer ? escapeHtml(customer.name) : escapeHtml(order.customerName || 'غير معروف')}</td>
        <td>${service ? escapeHtml(service.name) : 'غير معروف'}</td>
        <td>${escapeHtml(employeeDisplay)}</td>
        <td><span class="${statusClass}">${escapeHtml(order.status || 'جديد')}</span> ${approvalBadge}</td>
        <td class="${priorityClass}">${escapeHtml(order.priority || 'متوسطة')}</td>
        <td>$${total.toFixed(2)}</td>
        <td>$${remaining.toFixed(2)}</td>
        <td>
          <div class="d-flex align-items-center gap-2">
            <div class="progress flex-grow-1" style="height: 6px; min-width: 50px;">
              <div class="progress-bar bg-primary" style="width: ${completionRate}%"></div>
            </div>
            <span class="small">${completionRate}%</span>
          </div>
        </td>
        <td>
          ${order.approvalStatus === 'pending' ? `
            <button class="btn btn-sm btn-outline-success approve-order-btn" data-id="${order.id}" title="موافقة">
              <i class="fas fa-check"></i>
            </button>
          ` : ''}
          <button class="btn btn-sm btn-outline-primary edit-btn" data-id="${order.id}" title="تعديل">
            <i class="fas fa-edit"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger delete-btn" data-id="${order.id}" title="حذف">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;

  tbody.querySelectorAll('.edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.id));
  });
  tbody.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => confirmDelete(btn.dataset.id));
  });
  tbody.querySelectorAll('.approve-order-btn').forEach((btn) => {
    btn.addEventListener('click', () => approveOrder(btn.dataset.id));
  });
}

// =============================================================
// 5. البحث
// =============================================================
function filterOrders(term) {
  return orders.filter((o) => {
    const customer = customersList.find((c) => c.id === o.customerId);
    const customerName = customer ? customer.name.toLowerCase() : (o.customerName || '').toLowerCase();
    return (o.orderNumber && o.orderNumber.toLowerCase().includes(term)) || customerName.includes(term);
  });
}

function handleSearch(e) {
  const term = e.target.value.trim().toLowerCase();
  const filtered = term ? filterOrders(term) : orders;
  renderTable(filtered);
  const rc = document.getElementById('resultCount');
  if (rc) rc.textContent = `عرض ${filtered.length} طلب`;
}

// =============================================================
// 6. مودال الإضافة
// =============================================================
function openAddModal() {
  editingId = null;
  document.getElementById('modalTitle').textContent = 'طلب جديد';
  document.getElementById('orderForm').reset();
  document.getElementById('orderId').value = '';
  document.getElementById('status').value = 'جديد';
  document.getElementById('priority').value = 'متوسطة';
  document.getElementById('discount').value = 0;
  document.getElementById('tax').value = 0;
  document.getElementById('paid').value = 0;
  document.getElementById('price').value = '';
  document.getElementById('total').value = '';

  populateSelects();
  renderEmployeeCheckboxes([]);
  renderStages([]);

  ['price', 'discount', 'tax'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', calculateTotal);
  });

  if (typeof flatpickr !== 'undefined') {
    flatpickr('#deadline', { locale: 'ar', dateFormat: 'Y-m-d', minDate: 'today' });
  }

  if (orderModalInstance) orderModalInstance.show();
}

// =============================================================
// 7. مودال التعديل
// =============================================================
function openEditModal(id) {
  const order = orders.find((o) => o.id === id);
  if (!order) {
    showToast('الطلب غير موجود', 'error');
    return;
  }

  editingId = id;
  document.getElementById('modalTitle').textContent = 'تعديل الطلب';
  document.getElementById('orderId').value = id;
  document.getElementById('customer').value = order.customerId || '';
  document.getElementById('service').value = order.serviceId || '';
  document.getElementById('deadline').value = order.deadline ? formatDate(order.deadline) : '';
  document.getElementById('price').value = order.price || '';
  document.getElementById('discount').value = order.discount || 0;
  document.getElementById('tax').value = order.tax || 0;
  document.getElementById('paid').value = order.paid || 0;
  document.getElementById('status').value = order.status || 'جديد';
  document.getElementById('priority').value = order.priority || 'متوسطة';
  document.getElementById('notes').value = order.notes || '';

  populateSelects();
  renderEmployeeCheckboxes(order.assignedEmployeeIds || []);
  renderStages(order.stages || []);
  calculateTotal();

  ['price', 'discount', 'tax'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', calculateTotal);
  });

  if (typeof flatpickr !== 'undefined') {
    flatpickr('#deadline', { locale: 'ar', dateFormat: 'Y-m-d', minDate: 'today' });
  }

  if (orderModalInstance) orderModalInstance.show();
}

// =============================================================
// 8. عرض خانات الموظفين (Multi-select)
// =============================================================
function renderEmployeeCheckboxes(selectedUids) {
  // إنشاء حاوية إن لم تكن موجودة
  let container = document.getElementById('employeeCheckboxesContainer');
  if (!container) {
    const empSelect = document.getElementById('employee');
    if (empSelect) {
      // استبدال select بحاوية checkboxes
      container = document.createElement('div');
      container.id = 'employeeCheckboxesContainer';
      container.className = 'border rounded p-2';
      container.style.maxHeight = '120px';
      container.style.overflowY = 'auto';
      empSelect.parentNode.replaceChild(container, empSelect);
    } else {
      return;
    }
  }

  if (employeesList.length === 0) {
    container.innerHTML = '<p class="text-muted small mb-0">لا يوجد موظفون نشطون</p>';
    return;
  }

  let html = '';
  employeesList.forEach((emp) => {
    const uid = emp.uid || emp.id;
    const checked = selectedUids.includes(uid) || selectedUids.includes(emp.id) ? 'checked' : '';
    html += `
      <div class="form-check">
        <input class="form-check-input emp-checkbox" type="checkbox" value="${uid}" id="ord_emp_${uid}" ${checked}>
        <label class="form-check-label" for="ord_emp_${uid}">
          ${escapeHtml(emp.name)} <small class="text-muted">(${escapeHtml(emp.position || '')})</small>
        </label>
      </div>
    `;
  });
  container.innerHTML = html;
}

// =============================================================
// 9. عرض المراحل مع خيار الرؤية للعميل
// =============================================================
function renderStages(savedStages) {
  const container = document.getElementById('stagesContainer');
  if (!container) return;
  container.innerHTML = '';

  const stagesWithStatus = STAGES.map((stage) => {
    const found = savedStages.find((s) => s.stage === stage.name);
    return {
      stage: stage.name,
      completed: found ? found.completed : false,
      customerVisible: found ? found.customerVisible : stage.customerVisible,
    };
  });

  stagesWithStatus.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'form-check d-flex align-items-center gap-2';
    div.innerHTML = `
      <input class="form-check-input stage-checkbox" type="checkbox" id="stage_${index}"
        data-stage="${item.stage}" ${item.completed ? 'checked' : ''}>
      <label class="form-check-label" for="stage_${index}">
        ${item.stage}
      </label>
      <div class="form-check ms-3">
        <input class="form-check-input stage-visible-checkbox" type="checkbox" id="vis_${index}"
          data-stage="${item.stage}" ${item.customerVisible ? 'checked' : ''}>
        <label class="form-check-label small text-muted" for="vis_${index}">
          مرئية للعميل
        </label>
      </div>
    `;
    container.appendChild(div);
  });

  document.querySelectorAll('.stage-checkbox').forEach((cb) => {
    cb.addEventListener('change', updateCompletionRate);
  });
}

function updateCompletionRate() {
  const checkboxes = document.querySelectorAll('.stage-checkbox');
  const checked = document.querySelectorAll('.stage-checkbox:checked').length;
  const total = checkboxes.length;
  const rate = total > 0 ? Math.round((checked / total) * 100) : 0;
  const badge = document.getElementById('completionBadge');
  if (badge) badge.textContent = `نسبة الإنجاز: ${rate}%`;
  return rate;
}

// =============================================================
// 10. حساب الإجمالي
// =============================================================
function calculateTotal() {
  const price = parseFloat(document.getElementById('price').value) || 0;
  const discount = parseFloat(document.getElementById('discount').value) || 0;
  const taxRate = parseFloat(document.getElementById('tax').value) || 0;
  const total = price - discount + (price - discount) * (taxRate / 100);
  const totalEl = document.getElementById('total');
  if (totalEl) totalEl.value = total.toFixed(2);
  return total;
}

// =============================================================
// 11. حفظ الطلب
// =============================================================
document.getElementById('saveOrderBtn')?.addEventListener('click', async () => {
  const customerId = document.getElementById('customer').value;
  const serviceId = document.getElementById('service').value;
  const price = parseFloat(document.getElementById('price').value) || 0;

  if (!customerId || !serviceId || price <= 0) {
    showToast('يرجى اختيار العميل والخدمة وتحديد سعر صحيح', 'warning');
    return;
  }

  // جمع الموظفين المختارين
  const selectedEmps = Array.from(document.querySelectorAll('.emp-checkbox:checked')).map((cb) => cb.value);

  // جمع المراحل
  const stageCheckboxes = document.querySelectorAll('.stage-checkbox');
  const visibleCheckboxes = document.querySelectorAll('.stage-visible-checkbox');
  const stages = Array.from(stageCheckboxes).map((cb) => {
    const stageName = cb.dataset.stage;
    const visibleCb = Array.from(visibleCheckboxes).find((v) => v.dataset.stage === stageName);
    return {
      stage: stageName,
      completed: cb.checked,
      customerVisible: visibleCb ? visibleCb.checked : false,
    };
  });

  const completionRate = updateCompletionRate();
  const total = calculateTotal();
  const paid = parseFloat(document.getElementById('paid').value) || 0;

  // الحصول على customerUid من الخيار المختار
  const selectedOption = document.getElementById('customer').selectedOptions[0];
  const customerUid = selectedOption?.dataset.uid || null;

  const status = document.getElementById('status').value;

  // تحديد approvalStatus حسب الحالة
  let approvalStatus = 'pending';
  if (status === 'مكتمل' || status === 'قيد التنفيذ') {
    approvalStatus = 'approved';
  } else if (status === 'ملغي') {
    approvalStatus = 'rejected';
  }

  const data = {
    customerId,
    customerUid,
    serviceId,
    assignedEmployeeIds: selectedEmps,
    employeeId: selectedEmps[0] || null, // الاحتفاظ بالحقل القائم (أول موظف)
    price,
    discount: parseFloat(document.getElementById('discount').value) || 0,
    tax: parseFloat(document.getElementById('tax').value) || 0,
    total,
    paid,
    status,
    approvalStatus,
    lifecycleStage: status === 'مكتمل' ? 'completed' : status === 'قيد التنفيذ' ? 'in_progress' : status === 'ملغي' ? 'cancelled' : 'pending',
    priority: document.getElementById('priority').value,
    notes: document.getElementById('notes').value.trim(),
    stages,
    completionRate,
    deadline: document.getElementById('deadline').value || null,
    updatedAt: new Date().toISOString(),
  };

  const id = document.getElementById('orderId').value;
  const btn = document.getElementById('saveOrderBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>جاري الحفظ...';

  try {
    if (id) {
      await updateDoc(doc(db, 'orders', id), data);
      showToast('تم تحديث الطلب بنجاح', 'success');
    } else {
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const count = orders.length + 1;
      data.orderNumber = `ORD-${dateStr}-${String(count).padStart(3, '0')}`;
      data.createdAt = serverTimestamp();
      data.createdBy = getCurrentUid();
      await addDoc(collection(db, 'orders'), data);
      showToast('تم إضافة الطلب بنجاح', 'success');
    }
    if (orderModalInstance) orderModalInstance.hide();
  } catch (error) {
    console.error('Error saving order:', error);
    let msg = 'حدث خطأ أثناء الحفظ';
    if (error.code === 'permission-denied') msg = 'ليس لديك صلاحية';
    showToast(msg, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save me-2"></i>حفظ';
  }
});

// =============================================================
// 12. موافقة على الطلب
// =============================================================
async function approveOrder(id) {
  const order = orders.find((o) => o.id === id);
  if (!order) return;

  const result = await Swal.fire({
    title: 'موافقة على الطلب؟',
    text: `سيتم اعتماد الطلب #${order.orderNumber} والسماح ببدء العمل عليه.`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'نعم، اعتمد',
    cancelButtonText: 'إلغاء',
    confirmButtonColor: '#28a745',
  });

  if (!result.isConfirmed) return;

  try {
    await updateDoc(doc(db, 'orders', id), {
      approvalStatus: 'approved',
      approvedAt: new Date().toISOString(),
      approvedBy: getCurrentUid(),
      lifecycleStage: 'approved',
      status: order.status === 'جديد' ? 'قيد التنفيذ' : order.status,
      updatedAt: new Date().toISOString(),
    });
    showToast('تم اعتماد الطلب', 'success');
  } catch (error) {
    showToast('تعذّر الاعتماد: ' + error.message, 'error');
  }
}

// =============================================================
// 13. حذف
// =============================================================
async function confirmDelete(id) {
  const order = orders.find((o) => o.id === id);
  if (!order) return;

  const result = await Swal.fire({
    title: 'حذف الطلب؟',
    text: `سيتم حذف الطلب #${order.orderNumber} نهائيًا.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    confirmButtonText: 'نعم، احذف',
    cancelButtonText: 'إلغاء',
  });

  if (!result.isConfirmed) return;

  try {
    await deleteDoc(doc(db, 'orders', id));
    showToast('تم حذف الطلب', 'success');
  } catch (error) {
    showToast('تعذّر الحذف', 'error');
  }
}

console.log('✅ orders.js loaded (updated with lifecycle + multi-assign + approvals)');
