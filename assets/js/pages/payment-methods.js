// =============================================================
// payment-methods.js — إدارة طرق الدفع القابلة للتهيئة
// =============================================================

import { auth, db } from '../firebase-config.js';
import {
  collection, addDoc, doc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp,
} from 'firebase/firestore';
import { initPage, escapeHtml, showToast } from '../init.js';
import { initDynamicSidebar } from '../sidebar.js';
import { requireAdmin } from '../permissions.js';

let methods = [];
let methodModalInstance = null;
let methodsListener = null;
let editingId = null;

initPage({
  onReady: async () => {
    if (!requireAdmin()) return;
    initDynamicSidebar();
    listenToMethods();

    document.getElementById('addMethodBtn')?.addEventListener('click', openAddModal);
    document.getElementById('saveMethodBtn')?.addEventListener('click', saveMethod);

    const modalEl = document.getElementById('methodModal');
    if (modalEl) {
      methodModalInstance = new bootstrap.Modal(modalEl);
      modalEl.addEventListener('hidden.bs.modal', () => {
        document.getElementById('methodForm').reset();
        document.getElementById('methodId').value = '';
        editingId = null;
      });
    }
  },
});

function listenToMethods() {
  if (methodsListener) methodsListener();
  const q = query(collection(db, 'paymentMethods'), orderBy('createdAt', 'asc'));
  methodsListener = onSnapshot(q, (snapshot) => {
    methods = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderTable();
  }, (error) => {
    console.error('Error:', error);
    showToast('حدث خطأ', 'error');
  });
}

function renderTable() {
  const tbody = document.getElementById('methodsTableBody');
  if (!tbody) return;
  if (methods.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">لا توجد طرق دفع. أضف طريقة ليتمكن العملاء من الدفع.</td></tr>`;
    return;
  }
  let html = '';
  methods.forEach((m, i) => {
    html += `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${escapeHtml(m.name || '')}</strong></td>
        <td>${escapeHtml(m.holder || '-')}</td>
        <td>${escapeHtml(m.identifier || '-')}</td>
        <td><small class="text-muted">${escapeHtml(m.instructions || '-')}</small></td>
        <td>${m.active !== false ? '<span class="badge bg-success">نشطة</span>' : '<span class="badge bg-secondary">معطّلة</span>'}</td>
        <td>
          <button class="btn btn-sm btn-outline-primary edit-btn" data-id="${m.id}"><i class="fas fa-edit"></i></button>
          <button class="btn btn-sm btn-outline-danger delete-btn" data-id="${m.id}"><i class="fas fa-trash"></i></button>
        </td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
  tbody.querySelectorAll('.edit-btn').forEach((b) => b.addEventListener('click', () => openEditModal(b.dataset.id)));
  tbody.querySelectorAll('.delete-btn').forEach((b) => b.addEventListener('click', () => confirmDelete(b.dataset.id)));
}

function openAddModal() {
  editingId = null;
  document.getElementById('methodModalTitle').textContent = 'طريقة دفع جديدة';
  document.getElementById('methodForm').reset();
  document.getElementById('methodId').value = '';
  document.getElementById('methodActive').checked = true;
  if (methodModalInstance) methodModalInstance.show();
}

function openEditModal(id) {
  const m = methods.find((x) => x.id === id);
  if (!m) return;
  editingId = id;
  document.getElementById('methodModalTitle').textContent = 'تعديل طريقة الدفع';
  document.getElementById('methodId').value = id;
  document.getElementById('methodName').value = m.name || '';
  document.getElementById('methodHolder').value = m.holder || '';
  document.getElementById('methodIdentifier').value = m.identifier || '';
  document.getElementById('methodInstructions').value = m.instructions || '';
  document.getElementById('methodActive').checked = m.active !== false;
  if (methodModalInstance) methodModalInstance.show();
}

async function saveMethod() {
  const name = document.getElementById('methodName').value.trim();
  if (!name) {
    showToast('اسم طريقة الدفع مطلوب', 'warning');
    return;
  }

  const data = {
    name,
    holder: document.getElementById('methodHolder').value.trim(),
    identifier: document.getElementById('methodIdentifier').value.trim(),
    instructions: document.getElementById('methodInstructions').value.trim(),
    active: document.getElementById('methodActive').checked,
    updatedAt: new Date().toISOString(),
  };

  const btn = document.getElementById('saveMethodBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>جاري...';

  try {
    const id = document.getElementById('methodId').value;
    if (id) {
      await updateDoc(doc(db, 'paymentMethods', id), data);
      showToast('تم تحديث طريقة الدفع', 'success');
    } else {
      data.createdAt = serverTimestamp();
      data.createdBy = auth.currentUser?.uid;
      await addDoc(collection(db, 'paymentMethods'), data);
      showToast('تم إضافة طريقة الدفع', 'success');
    }
    if (methodModalInstance) methodModalInstance.hide();
  } catch (error) {
    showToast('تعذّر الحفظ: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save me-2"></i>حفظ';
  }
}

async function confirmDelete(id) {
  const m = methods.find((x) => x.id === id);
  if (!m) return;
  const result = await Swal.fire({
    title: 'حذف طريقة الدفع؟', text: `"${m.name}" ستُحذف نهائيًا.`,
    icon: 'warning', showCancelButton: true,
    confirmButtonColor: '#dc3545', confirmButtonText: 'نعم', cancelButtonText: 'إلغاء',
  });
  if (!result.isConfirmed) return;
  try {
    await deleteDoc(doc(db, 'paymentMethods', id));
    showToast('تم الحذف', 'success');
  } catch (e) { showToast('تعذّر الحذف', 'error'); }
}

console.log('✅ payment-methods.js loaded');
