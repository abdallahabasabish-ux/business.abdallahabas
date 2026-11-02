// =============================================================
// inquiries.js — إدارة الاستفسارات والقيادات
// =============================================================

import { db } from '../firebase-config.js';
import {
  collection, addDoc, doc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, getDocs, serverTimestamp,
} from 'firebase/firestore';
import {
  initPage, formatCurrency, formatDate, escapeHtml, showToast,
} from '../init.js';
import { initDynamicSidebar } from '../sidebar.js';
import { getCurrentUid } from '../permissions.js';

let inquiries = [];
let services = [];
let editingId = null;
let inquiriesListener = null;
let inquiryModalInstance = null;

// =============================================================
// 1. التهيئة
// =============================================================
initPage({
  onReady: async () => {
    initDynamicSidebar();
    await loadServices();
    listenToInquiries();

    document.getElementById('addInquiryBtn')?.addEventListener('click', openAddModal);
    document.getElementById('saveInquiryBtn')?.addEventListener('click', saveInquiry);
    document.getElementById('searchInput')?.addEventListener('input', applyFilters);
    document.getElementById('statusFilter')?.addEventListener('change', applyFilters);

    const modalEl = document.getElementById('inquiryModal');
    if (modalEl) {
      inquiryModalInstance = new bootstrap.Modal(modalEl);
      modalEl.addEventListener('hidden.bs.modal', () => {
        document.getElementById('inquiryForm').reset();
        document.getElementById('inquiryId').value = '';
        editingId = null;
      });
    }
  },
});

// =============================================================
// 2. تحميل الخدمات
// =============================================================
async function loadServices() {
  try {
    const snap = await getDocs(collection(db, 'services'));
    services = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const select = document.getElementById('inqService');
    if (select) {
      select.innerHTML = '<option value="">غير محدد</option>';
      services.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.name} (${formatCurrency(s.price)})`;
        select.appendChild(opt);
      });
    }
  } catch (error) {
    console.error('Error loading services:', error);
  }
}

// =============================================================
// 3. الاستماع للاستفسارات
// =============================================================
function listenToInquiries() {
  if (inquiriesListener) inquiriesListener();

  const q = query(collection(db, 'inquiries'), orderBy('createdAt', 'desc'));
  inquiriesListener = onSnapshot(q, (snapshot) => {
    inquiries = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    applyFilters();
    updateStats();
  }, (error) => {
    console.error('Error listening to inquiries:', error);
    showToast('حدث خطأ في تحميل الاستفسارات', 'error');
  });
}

// =============================================================
// 4. تطبيق الفلاتر
// =============================================================
function applyFilters() {
  const searchTerm = document.getElementById('searchInput')?.value.trim().toLowerCase() || '';
  const statusFilter = document.getElementById('statusFilter')?.value || '';

  let filtered = inquiries;

  if (statusFilter) {
    filtered = filtered.filter((i) => i.status === statusFilter);
  }

  if (searchTerm) {
    filtered = filtered.filter((i) =>
      (i.customerName && i.customerName.toLowerCase().includes(searchTerm)) ||
      (i.phone && i.phone.includes(searchTerm)) ||
      (i.email && i.email.toLowerCase().includes(searchTerm))
    );
  }

  renderTable(filtered);
}

// =============================================================
// 5. عرض الجدول
// =============================================================
function renderTable(list) {
  const tbody = document.getElementById('inquiriesTableBody');
  if (!tbody) return;

  if (!list || list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">لا توجد استفسارات</td></tr>`;
    return;
  }

  const statusLabels = {
    new: { cls: 'inq-new', label: 'جديد' },
    contacted: { cls: 'inq-contacted', label: 'تم التواصل' },
    interested: { cls: 'inq-interested', label: 'مهتم' },
    quotation_sent: { cls: 'inq-quotation', label: 'عرض سعر' },
    negotiation: { cls: 'inq-negotiation', label: 'تفاوض' },
    converted: { cls: 'inq-converted', label: 'محوّل' },
    rejected: { cls: 'inq-rejected', label: 'مرفوض' },
    lost: { cls: 'inq-lost', label: 'مفقود' },
  };

  const sourceLabels = {
    website: 'الموقع', phone: 'هاتف', email: 'بريد',
    social: 'سوشيال', referral: 'إحالة', walk_in: 'زيارة', other: 'أخرى',
  };

  let html = '';
  list.forEach((inq, index) => {
    const svc = services.find((s) => s.id === inq.serviceId);
    const sInfo = statusLabels[inq.status] || statusLabels.new;

    html += `
      <tr>
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(inq.customerName || '')}</strong></td>
        <td>${escapeHtml(inq.phone || '')}<br/><small class="text-muted">${escapeHtml(inq.email || '')}</small></td>
        <td>${svc ? escapeHtml(svc.name) : '<span class="text-muted">غير محدد</span>'}</td>
        <td><span class="badge bg-light text-dark">${escapeHtml(sourceLabels[inq.source] || inq.source || '-')}</span></td>
        <td>${inq.estimatedValue ? formatCurrency(inq.estimatedValue) : '-'}</td>
        <td><span class="inq-status-badge ${sInfo.cls}">${sInfo.label}</span></td>
        <td>${formatDate(inq.createdAt)}</td>
        <td>
          ${inq.status !== 'converted' ? `
            <button class="btn btn-sm btn-outline-success convert-btn" data-id="${inq.id}" title="تحويل لطلب">
              <i class="fas fa-exchange-alt"></i>
            </button>
          ` : '<span class="badge bg-success">محوّل</span>'}
          <button class="btn btn-sm btn-outline-primary edit-btn" data-id="${inq.id}">
            <i class="fas fa-edit"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger delete-btn" data-id="${inq.id}">
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
  tbody.querySelectorAll('.convert-btn').forEach((btn) => {
    btn.addEventListener('click', () => convertToOrder(btn.dataset.id));
  });
}

// =============================================================
// 6. الإحصائيات
// =============================================================
function updateStats() {
  const total = inquiries.length;
  const newCount = inquiries.filter((i) => i.status === 'new').length;
  const converted = inquiries.filter((i) => i.status === 'converted').length;
  const lost = inquiries.filter((i) => i.status === 'lost' || i.status === 'rejected').length;
  const rate = total > 0 ? Math.round((converted / total) * 100) : 0;
  const estimatedValue = inquiries
    .filter((i) => i.status !== 'lost' && i.status !== 'rejected')
    .reduce((sum, i) => sum + (i.estimatedValue || 0), 0);

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statNew').textContent = newCount;
  document.getElementById('statConverted').textContent = converted;
  document.getElementById('statLost').textContent = lost;
  document.getElementById('statConversionRate').textContent = `${rate}%`;
  document.getElementById('statEstimatedValue').textContent = formatCurrency(estimatedValue);
}

// =============================================================
// 7. مودال الإضافة/التعديل
// =============================================================
function openAddModal() {
  editingId = null;
  document.getElementById('inquiryModalTitle').textContent = 'استفسار جديد';
  document.getElementById('inquiryForm').reset();
  document.getElementById('inquiryId').value = '';
  document.getElementById('inqStatus').value = 'new';
  document.getElementById('inqSource').value = 'website';
  if (inquiryModalInstance) inquiryModalInstance.show();
}

function openEditModal(id) {
  const inq = inquiries.find((i) => i.id === id);
  if (!inq) {
    showToast('الاستفسار غير موجود', 'error');
    return;
  }

  editingId = id;
  document.getElementById('inquiryModalTitle').textContent = 'تعديل الاستفسار';
  document.getElementById('inquiryId').value = id;
  document.getElementById('inqCustomerName').value = inq.customerName || '';
  document.getElementById('inqPhone').value = inq.phone || '';
  document.getElementById('inqEmail').value = inq.email || '';
  document.getElementById('inqSource').value = inq.source || 'website';
  document.getElementById('inqService').value = inq.serviceId || '';
  document.getElementById('inqEstimatedValue').value = inq.estimatedValue || '';
  document.getElementById('inqNotes').value = inq.notes || '';
  document.getElementById('inqStatus').value = inq.status || 'new';

  if (inquiryModalInstance) inquiryModalInstance.show();
}

// =============================================================
// 8. حفظ الاستفسار
// =============================================================
async function saveInquiry() {
  const name = document.getElementById('inqCustomerName').value.trim();
  const phone = document.getElementById('inqPhone').value.trim();

  if (!name || !phone) {
    showToast('الاسم والهاتف مطلوبان', 'warning');
    return;
  }

  const data = {
    customerName: name,
    phone,
    email: document.getElementById('inqEmail').value.trim(),
    source: document.getElementById('inqSource').value,
    serviceId: document.getElementById('inqService').value || null,
    estimatedValue: parseFloat(document.getElementById('inqEstimatedValue').value) || 0,
    notes: document.getElementById('inqNotes').value.trim(),
    status: document.getElementById('inqStatus').value,
    updatedAt: new Date().toISOString(),
  };

  const btn = document.getElementById('saveInquiryBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>جاري الحفظ...';

  try {
    const id = document.getElementById('inquiryId').value;

    if (id) {
      await updateDoc(doc(db, 'inquiries', id), data);
      showToast('تم تحديث الاستفسار', 'success');
    } else {
      data.createdBy = getCurrentUid();
      data.createdAt = serverTimestamp();
      data.inquiryNumber = `INQ-${Date.now().toString().slice(-6)}`;
      await addDoc(collection(db, 'inquiries'), data);
      showToast('تم إضافة الاستفسار', 'success');
    }

    if (inquiryModalInstance) inquiryModalInstance.hide();
  } catch (error) {
    console.error('Error saving inquiry:', error);
    let msg = 'حدث خطأ أثناء الحفظ';
    if (error.code === 'permission-denied') msg = 'ليس لديك صلاحية';
    showToast(msg, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save me-2"></i>حفظ';
  }
}

// =============================================================
// 9. تحويل استفسار إلى طلب
// =============================================================
async function convertToOrder(id) {
  const inq = inquiries.find((i) => i.id === id);
  if (!inq) return;

  const result = await Swal.fire({
    title: 'تحويل الاستفسار إلى طلب؟',
    text: `سيتم إنشاء طلب جديد من استفسار "${inq.customerName}" وتحديث حالة الاستفسار إلى «محوّل».`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'نعم، حوّل',
    cancelButtonText: 'إلغاء',
    confirmButtonColor: '#28a745',
  });

  if (!result.isConfirmed) return;

  try {
    // إنشاء طلب جديد
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const orderData = {
      orderNumber: `ORD-${dateStr}-${Math.floor(Math.random() * 9000 + 1000)}`,
      customerId: null, // العميل لم يُربط بعد
      customerUid: null,
      customerName: inq.customerName,
      customerPhone: inq.phone,
      customerEmail: inq.email || null,
      serviceId: inq.serviceId || null,
      description: `محوّل من استفسار: ${inq.notes || ''}`,
      price: inq.estimatedValue || 0,
      discount: 0,
      tax: 0,
      total: inq.estimatedValue || 0,
      paid: 0,
      status: 'جديد',
      priority: 'متوسطة',
      notes: inq.notes || '',
      stages: [],
      completionRate: 0,
      deadline: null,
      source: 'inquiry_conversion',
      inquiryId: id,
      lifecycleStage: 'approved',
      approvalStatus: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: new Date().toISOString(),
    };

    const orderRef = await addDoc(collection(db, 'orders'), orderData);

    // تحديث الاستفسار
    await updateDoc(doc(db, 'inquiries', id), {
      status: 'converted',
      convertedOrderId: orderRef.id,
      convertedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    showToast('تم تحويل الاستفسار إلى طلب بنجاح', 'success');
  } catch (error) {
    console.error('Error converting inquiry:', error);
    showToast('تعذّر التحويل: ' + error.message, 'error');
  }
}

// =============================================================
// 10. حذف
// =============================================================
async function confirmDelete(id) {
  const inq = inquiries.find((i) => i.id === id);
  if (!inq) return;

  const result = await Swal.fire({
    title: 'حذف الاستفسار؟',
    text: `سيتم حذف استفسار "${inq.customerName}" نهائيًا.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    confirmButtonText: 'نعم، احذف',
    cancelButtonText: 'إلغاء',
  });

  if (!result.isConfirmed) return;

  try {
    await deleteDoc(doc(db, 'inquiries', id));
    showToast('تم حذف الاستفسار', 'success');
  } catch (error) {
    showToast('تعذّر الحذف', 'error');
  }
}

console.log('✅ inquiries.js loaded');
