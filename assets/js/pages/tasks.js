// =============================================================
// tasks.js — إدارة المهام الكاملة
// =============================================================

import { db } from '../firebase-config.js';
import {
  collection, addDoc, doc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, getDocs, where, serverTimestamp,
} from 'firebase/firestore';
import {
  initPage, formatCurrency, formatDate, escapeHtml, showToast,
} from '../init.js';
import {
  renderSidebar, initDynamicSidebar,
} from '../sidebar.js';
import {
  isAdmin, hasPermission, getUserData, getCurrentUid,
} from '../permissions.js';

let tasks = [];
let employees = [];
let orders = [];
let editingId = null;
let tasksListener = null;
let currentFilter = 'all';
let taskModalInstance = null;

// =============================================================
// 1. التهيئة
// =============================================================
initPage({
  onReady: async () => {
    // القائمة الجانبية الديناميكية
    initDynamicSidebar();

    // تحميل البيانات الأساسية
    await loadEmployees();
    await loadOrders();

    // الاستماع للمهام
    listenToTasks();

    // ربط الأحداث
    document.getElementById('addTaskBtn')?.addEventListener('click', openAddModal);
    document.getElementById('saveTaskBtn')?.addEventListener('click', saveTask);
    document.getElementById('searchInput')?.addEventListener('input', applyFilters);
    document.getElementById('employeeFilter')?.addEventListener('change', applyFilters);

    // فلاتر الحالة
    document.querySelectorAll('.filter-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        currentFilter = tab.dataset.filter;
        applyFilters();
      });
    });

    // مودال
    const modalEl = document.getElementById('taskModal');
    if (modalEl) {
      taskModalInstance = new bootstrap.Modal(modalEl);
      modalEl.addEventListener('hidden.bs.modal', () => {
        document.getElementById('taskForm').reset();
        document.getElementById('taskId').value = '';
        editingId = null;
      });
    }

    // تاريخ افتراضي
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 7);
    document.getElementById('taskDeadline').value = tomorrow.toISOString().slice(0, 10);
  },
});

// =============================================================
// 2. تحميل الموظفين
// =============================================================
async function loadEmployees() {
  try {
    const snap = await getDocs(collection(db, 'employees'));
    employees = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // تعبئة قائمة الفلتر
    const filter = document.getElementById('employeeFilter');
    if (filter) {
      filter.innerHTML = '<option value="">كل الموظفين</option>';
      employees.forEach((e) => {
        const opt = document.createElement('option');
        opt.value = e.uid || e.id;
        opt.textContent = e.name;
        filter.appendChild(opt);
      });
    }
  } catch (error) {
    console.error('Error loading employees:', error);
  }
}

// =============================================================
// 3. تحميل الطلبات
// =============================================================
async function loadOrders() {
  try {
    const snap = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc')));
    orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const select = document.getElementById('taskOrder');
    if (select) {
      select.innerHTML = '<option value="">بدون طلب</option>';
      orders.forEach((o) => {
        const opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = `#${o.orderNumber || 'N/A'} — ${o.description || o.notes || 'طلب'}`;
        select.appendChild(opt);
      });
    }
  } catch (error) {
    console.error('Error loading orders:', error);
  }
}

// =============================================================
// 4. الاستماع للمهام (Realtime)
// =============================================================
function listenToTasks() {
  if (tasksListener) tasksListener();

  const q = query(collection(db, 'tasks'), orderBy('createdAt', 'desc'));
  tasksListener = onSnapshot(q, (snapshot) => {
    tasks = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    applyFilters();
  }, (error) => {
    console.error('Error listening to tasks:', error);
    showToast('حدث خطأ في تحميل المهام', 'error');
  });
}

// =============================================================
// 5. تطبيق الفلاتر والعرض
// =============================================================
function applyFilters() {
  const searchTerm = document.getElementById('searchInput')?.value.trim().toLowerCase() || '';
  const employeeFilter = document.getElementById('employeeFilter')?.value || '';

  let filtered = tasks;

  // فلتر الحالة
  if (currentFilter !== 'all') {
    if (currentFilter === 'overdue') {
      const now = new Date();
      filtered = filtered.filter((t) => {
        if (['completed', 'cancelled'].includes(t.status)) return false;
        const d = t.deadline?.toDate ? t.deadline.toDate() : (t.deadline instanceof Date ? t.deadline : (t.deadline ? new Date(t.deadline) : null));
        return d && d < now;
      });
    } else {
      filtered = filtered.filter((t) => t.status === currentFilter);
    }
  }

  // فلتر الموظف
  if (employeeFilter) {
    filtered = filtered.filter((t) =>
      t.assignedEmployeeIds && t.assignedEmployeeIds.includes(employeeFilter)
    );
  }

  // فلتر البحث
  if (searchTerm) {
    filtered = filtered.filter((t) =>
      (t.title && t.title.toLowerCase().includes(searchTerm)) ||
      (t.description && t.description.toLowerCase().includes(searchTerm))
    );
  }

  renderTasks(filtered);
}

// =============================================================
// 6. عرض المهام
// =============================================================
function renderTasks(list) {
  const container = document.getElementById('tasksList');

  if (!list || list.length === 0) {
    container.innerHTML = `
      <div class="text-center py-5 text-muted">
        <i class="fas fa-tasks fa-3x mb-3"></i>
        <h5>لا توجد مهام</h5>
        <p>${hasPermission('canAssignTasks') ? 'انشئ مهمة جديدة للبدء' : 'لم تُسند إليك مهام بعد'}</p>
      </div>
    `;
    return;
  }

  let html = '';
  for (const task of list) {
    const statusLabels = {
      new: { cls: 'ts-new', label: 'جديدة' },
      assigned: { cls: 'ts-assigned', label: 'مُسندة' },
      in_progress: { cls: 'ts-progress', label: 'قيد التنفيذ' },
      under_review: { cls: 'ts-review', label: 'قيد المراجعة' },
      completed: { cls: 'ts-completed', label: 'مكتملة' },
      rejected: { cls: 'ts-rejected', label: 'مرفوضة' },
      cancelled: { cls: 'ts-rejected', label: 'ملغاة' },
    };
    const sInfo = statusLabels[task.status] || statusLabels.new;

    // عرض الموظفين المسندين
    const assignedEmployees = (task.assignedEmployeeIds || []).map((uid) => {
      const emp = employees.find((e) => (e.uid || e.id) === uid);
      return emp ? emp.name : null;
    }).filter(Boolean);

    const avatarsHtml = assignedEmployees.slice(0, 4).map((name) =>
      `<div class="emp-avatar" title="${escapeHtml(name)}">${escapeHtml(name.charAt(0))}</div>`
    ).join('');
    const extraCount = assignedEmployees.length > 4 ? `<div class="emp-avatar">+${assignedEmployees.length - 4}</div>` : '';

    const completionRate = task.completionRate || 0;
    const isOverdue = (() => {
      if (['completed', 'cancelled'].includes(task.status)) return false;
      const d = task.deadline?.toDate ? task.deadline.toDate() : (task.deadline instanceof Date ? task.deadline : (task.deadline ? new Date(task.deadline) : null));
      return d && d < new Date();
    })();

    html += `
      <div class="task-grid-card">
        <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
          <div style="flex:1; min-width:250px;">
            <div class="d-flex align-items-center gap-2 flex-wrap mb-1">
              <strong style="font-size:16px;">${escapeHtml(task.title || 'مهمة')}</strong>
              <span class="task-status-badge ${sInfo.cls}">${sInfo.label}</span>
              ${isOverdue ? '<span class="task-status-badge ts-overdue">متأخرة</span>' : ''}
              ${task.priority ? `<span class="priority-${task.priority}"><i class="fas fa-flag"></i></span>` : ''}
            </div>
            ${task.description ? `<div class="text-muted small mb-2">${escapeHtml(task.description.substring(0, 120))}${task.description.length > 120 ? '...' : ''}</div>` : ''}
            <div class="text-muted small d-flex gap-3 flex-wrap">
              <span><i class="fas fa-calendar"></i> ${formatDate(task.deadline)}</span>
              ${task.compensation ? `<span><i class="fas fa-dollar-sign"></i> ${formatCurrency(task.compensation)}</span>` : ''}
              ${task.orderId ? `<span><i class="fas fa-link"></i> طلب مرتبط</span>` : ''}
              <span><i class="fas fa-clock"></i> ${formatDate(task.createdAt)}</span>
            </div>
            ${assignedEmployees.length > 0 ? `
              <div class="mt-2 d-flex align-items-center">
                <div class="d-flex">${avatarsHtml}${extraCount}</div>
                <small class="text-muted ms-2">${assignedEmployees.length} موظف</small>
              </div>
            ` : '<small class="text-warning mt-2 d-block"><i class="fas fa-exclamation"></i> غير معيّن</small>'}
          </div>
          <div class="d-flex gap-1 flex-wrap">
            ${task.status === 'under_review' ? `
              <button class="btn btn-sm btn-outline-success approve-task-btn" data-id="${task.id}" title="اعتماد">
                <i class="fas fa-check"></i>
              </button>
              <button class="btn btn-sm btn-outline-danger reject-task-btn" data-id="${task.id}" title="رفض">
                <i class="fas fa-times"></i>
              </button>
            ` : ''}
            <button class="btn btn-sm btn-outline-primary edit-task-btn" data-id="${task.id}" data-action-permission="canAssignTasks">
              <i class="fas fa-edit"></i>
            </button>
            <button class="btn btn-sm btn-outline-danger delete-task-btn" data-id="${task.id}">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
        ${completionRate > 0 ? `
          <div class="mt-2">
            <div class="d-flex justify-content-between small text-muted mb-1">
              <span>نسبة الإنجاز</span><span>${completionRate}%</span>
            </div>
            <div class="progress" style="height:5px;">
              <div class="progress-bar bg-primary" style="width:${completionRate}%"></div>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  container.innerHTML = html;

  // ربط الأحداث
  container.querySelectorAll('.edit-task-btn').forEach((btn) => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.id));
  });
  container.querySelectorAll('.delete-task-btn').forEach((btn) => {
    btn.addEventListener('click', () => confirmDelete(btn.dataset.id));
  });
  container.querySelectorAll('.approve-task-btn').forEach((btn) => {
    btn.addEventListener('click', () => approveTask(btn.dataset.id));
  });
  container.querySelectorAll('.reject-task-btn').forEach((btn) => {
    btn.addEventListener('click', () => rejectTask(btn.dataset.id));
  });
}

// =============================================================
// 7. مودال الإضافة
// =============================================================
function openAddModal() {
  editingId = null;
  document.getElementById('taskModalTitle').textContent = 'مهمة جديدة';
  document.getElementById('taskForm').reset();
  document.getElementById('taskId').value = '';
  document.getElementById('taskStatus').value = 'new';

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 7);
  document.getElementById('taskDeadline').value = tomorrow.toISOString().slice(0, 10);

  renderEmployeeCheckboxes([]);
  if (taskModalInstance) taskModalInstance.show();
}

// =============================================================
// 8. مودال التعديل
// =============================================================
function openEditModal(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) {
    showToast('المهمة غير موجودة', 'error');
    return;
  }

  editingId = id;
  document.getElementById('taskModalTitle').textContent = 'تعديل المهمة';
  document.getElementById('taskId').value = id;
  document.getElementById('taskTitle').value = task.title || '';
  document.getElementById('taskDescription').value = task.description || '';
  document.getElementById('taskOrder').value = task.orderId || '';
  document.getElementById('taskDeadline').value = formatDate(task.deadline);
  document.getElementById('taskPriority').value = task.priority || 'medium';
  document.getElementById('taskCompensation').value = task.compensation || '';
  document.getElementById('taskStatus').value = task.status || 'new';
  document.getElementById('taskNotes').value = task.notes || '';

  renderEmployeeCheckboxes(task.assignedEmployeeIds || []);

  if (taskModalInstance) taskModalInstance.show();
}

// =============================================================
// 9. عرض خانات الموظفين (Multi-select)
// =============================================================
function renderEmployeeCheckboxes(selectedUids) {
  const container = document.getElementById('employeeCheckboxes');
  if (!container) return;

  if (employees.length === 0) {
    container.innerHTML = '<p class="text-muted small mb-0">لا يوجد موظفون. أضف موظفين من صفحة الموظفين.</p>';
    return;
  }

  const activeEmployees = employees.filter((e) => !e.status || e.status === 'نشط');

  let html = '';
  activeEmployees.forEach((emp) => {
    const uid = emp.uid || emp.id;
    const checked = selectedUids.includes(uid) ? 'checked' : '';
    html += `
      <div class="form-check">
        <input class="form-check-input emp-checkbox" type="checkbox" value="${uid}" id="emp_${uid}" ${checked}>
        <label class="form-check-label" for="emp_${uid}">
          ${escapeHtml(emp.name)} <small class="text-muted">(${escapeHtml(emp.position || '')})</small>
        </label>
      </div>
    `;
  });

  container.innerHTML = html;
}

// =============================================================
// 10. حفظ المهمة
// =============================================================
async function saveTask() {
  const title = document.getElementById('taskTitle').value.trim();
  const deadline = document.getElementById('taskDeadline').value;

  if (!title) {
    showToast('عنوان المهمة مطلوب', 'warning');
    return;
  }

  if (!deadline) {
    showToast('الموعد النهائي مطلوب', 'warning');
    return;
  }

  // جمع الموظفين المختارين
  const selectedEmps = Array.from(document.querySelectorAll('.emp-checkbox:checked')).map((cb) => cb.value);

  if (selectedEmps.length === 0) {
    showToast('اختر موظفًا واحدًا على الأقل', 'warning');
    return;
  }

  const data = {
    title,
    description: document.getElementById('taskDescription').value.trim(),
    orderId: document.getElementById('taskOrder').value || null,
    deadline: new Date(deadline + 'T23:59:59'),
    assignedEmployeeIds: selectedEmps,
    priority: document.getElementById('taskPriority').value,
    compensation: parseFloat(document.getElementById('taskCompensation').value) || 0,
    status: document.getElementById('taskStatus').value,
    notes: document.getElementById('taskNotes').value.trim(),
    updatedAt: new Date().toISOString(),
  };

  const btn = document.getElementById('saveTaskBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>جاري الحفظ...';

  try {
    const id = document.getElementById('taskId').value;
    const uid = getCurrentUid();

    if (id) {
      // تعديل — القواعد تسمح للمدير أو من له canAssignTasks
      await updateDoc(doc(db, 'tasks', id), data);
      showToast('تم تحديث المهمة بنجاح', 'success');
    } else {
      // إنشاء
      data.assignedBy = uid;
      data.createdBy = uid;
      data.createdAt = serverTimestamp();
      data.milestones = [];
      data.comments = [];
      data.attachments = [];
      data.completionRate = 0;
      data.taskNumber = `TASK-${Date.now().toString().slice(-6)}`;
      await addDoc(collection(db, 'tasks'), data);
      showToast('تم إنشاء المهمة بنجاح', 'success');
    }

    if (taskModalInstance) taskModalInstance.hide();
  } catch (error) {
    console.error('Error saving task:', error);
    let msg = 'حدث خطأ أثناء الحفظ';
    if (error.code === 'permission-denied') {
      msg = 'ليس لديك صلاحية إنشاء/تعديل المهام';
    }
    showToast(msg, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save me-2"></i>حفظ';
  }
}

// =============================================================
// 11. اعتماد/رفض مهمة (عندما تكون قيد المراجعة)
// =============================================================
async function approveTask(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;

  const result = await Swal.fire({
    title: 'اعتماد المهمة؟',
    text: `سيتم اعتماد مهمة "${task.title}" وتسجيل التعويض للموظفين في دفتر الأستاذ.`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'نعم، اعتمد',
    cancelButtonText: 'إلغاء',
    confirmButtonColor: '#28a745',
  });

  if (!result.isConfirmed) return;

  try {
    const now = new Date().toISOString();

    // تحديث حالة المهمة
    await updateDoc(doc(db, 'tasks', id), {
      status: 'completed',
      completedAt: now,
      approvedBy: getCurrentUid(),
      updatedAt: now,
    });

    // إنشاء سجل في employeeLedger لكل موظف
    if (task.compensation && task.compensation > 0) {
      const ledgerPromises = (task.assignedEmployeeIds || []).map((empUid) => {
        const emp = employees.find((e) => (e.uid || e.id) === empUid);
        const empId = emp?.id || empUid;
        return addDoc(collection(db, 'employeeLedger'), {
          employeeId: empId,
          employeeUid: empUid,
          type: 'earning',
          amount: task.compensation,
          reason: `اعتماد مهمة: ${task.title}`,
          taskId: id,
          orderId: task.orderId || null,
          approvedBy: getCurrentUid(),
          status: 'approved',
          createdAt: serverTimestamp(),
          updatedAt: now,
        });
      });
      await Promise.all(ledgerPromises);
    }

    showToast('تم اعتماد المهمة وتسجيل المستحقات', 'success');
  } catch (error) {
    console.error('Error approving task:', error);
    showToast('تعذّر اعتماد المهمة: ' + error.message, 'error');
  }
}

async function rejectTask(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;

  const result = await Swal.fire({
    title: 'رفض المهمة؟',
    text: 'سيتم إعادتها للموظف بحالة «قيد التنفيذ» مع ملاحظة الرفض.',
    input: 'textarea',
    inputPlaceholder: 'سبب الرفض',
    showCancelButton: true,
    confirmButtonText: 'نعم، ارفض',
    cancelButtonText: 'إلغاء',
    confirmButtonColor: '#dc3545',
  });

  if (!result.isConfirmed) return;

  try {
    await updateDoc(doc(db, 'tasks', id), {
      status: 'in_progress',
      rejectionReason: result.value || '',
      updatedAt: new Date().toISOString(),
    });
    showToast('تم رفض المهمة وإعادتها للموظف', 'success');
  } catch (error) {
    showToast('تعذّر رفض المهمة', 'error');
  }
}

// =============================================================
// 12. حذف مهمة
// =============================================================
async function confirmDelete(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;

  const result = await Swal.fire({
    title: 'حذف المهمة؟',
    text: `سيتم حذف "${task.title}" نهائيًا.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    confirmButtonText: 'نعم، احذف',
    cancelButtonText: 'إلغاء',
  });

  if (!result.isConfirmed) return;

  try {
    await deleteDoc(doc(db, 'tasks', id));
    showToast('تم حذف المهمة', 'success');
  } catch (error) {
    showToast('تعذّر الحذف', 'error');
  }
}

console.log('✅ tasks.js loaded');
