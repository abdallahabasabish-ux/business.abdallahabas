// =============================================================
// employee-dashboard.js — لوحة الموظف المنفصلة
// =============================================================
// يعرض للموظف:
// - مهامه المسندة فقط (لا يرى مهام آخرين)
// - إحصائاته الشخصية
// - مستحققاته المالية (من employeeLedger)
// - لا يصل للبيانات المالية للشركة أو بيانات موظفين آخرين
// =============================================================

import { auth, db } from './firebase-config.js';
import {
  onAuthStateChanged, signOut,
} from 'firebase/auth';
import {
  collection, query, where, orderBy, onSnapshot,
  doc, getDoc,
} from 'firebase/firestore';
import {
  initPermissions, getUserData, isStaff, isAdmin,
} from './permissions.js';

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

function daysUntil(date) {
  if (!date) return null;
  if (date.toDate && typeof date.toDate === 'function') date = date.toDate();
  const d = date instanceof Date ? date : new Date(date);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = d - now;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
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
      text: message, duration: 3000, gravity: 'bottom', position: 'left',
      style: { background: colors[type] || colors.info },
      className: 'rounded-3 shadow',
    }).showToast();
  }
}

const STATUS_LABELS = {
  new: { cls: 'ts-new', label: 'جديدة' },
  assigned: { cls: 'ts-assigned', label: 'مُسندة' },
  in_progress: { cls: 'ts-progress', label: 'قيد التنفيذ' },
  under_review: { cls: 'ts-review', label: 'قيد المراجعة' },
  completed: { cls: 'ts-completed', label: 'مكتملة' },
  rejected: { cls: 'ts-rejected', label: 'مرفوضة' },
  cancelled: { cls: 'ts-rejected', label: 'ملغاة' },
  overdue: { cls: 'ts-overdue', label: 'متأخرة' },
};

function statusBadge(status) {
  const info = STATUS_LABELS[status] || STATUS_LABELS.new;
  return `<span class="task-status-badge ${info.cls}">${info.label}</span>`;
}

// =============================================================
// 2. التهيئة
// =============================================================
let currentUid = null;
let tasksListener = null;
let ledgerListener = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  currentUid = user.uid;

  // تهيئة الصلاحيات
  initPermissions(user);

  // انتظار تحميل بيانات المستخدم
  setTimeout(async () => {
    const userData = getUserData();

    if (!userData) {
      // المستخدم ليس له وثيقة في users — ربما عميل
      window.location.href = 'portal-login.html';
      return;
    }

    // المدير يذهب للوحة الإدارة
    if (isAdmin()) {
      window.location.href = 'dashboard.html';
      return;
    }

    if (!isStaff()) {
      // ليس موظفًا — ربما عميل
      window.location.href = 'portal-login.html';
      return;
    }

    // موظف — اعرض اللوحة
    document.getElementById('empLoading').style.display = 'none';
    document.getElementById('empContent').style.display = 'block';

    document.getElementById('empWelcome').textContent =
      `مرحباً ${user.displayName || userData.email || 'موظف'}`;

    const roleLabels = {
      'مدير': 'مدير النظام', 'محاسب': 'محاسب',
      'مشرف': 'مشرف', 'موظف': 'موظف',
    };
    document.getElementById('empRole').textContent = roleLabels[userData.role] || userData.role;

    // تحميل البيانات
    loadMyTasks();
    loadEarnings();

    // زر الخروج
    document.getElementById('empLogoutBtn')?.addEventListener('click', async () => {
      try { await signOut(auth); } catch (e) {}
      window.location.href = 'login.html';
    });
  }, 800);
});

// =============================================================
// 3. تحميل مهامي (Realtime)
// =============================================================
function loadMyTasks() {
  // المهام حيث assignedEmployeeIds يتضمن معرّفي
  const q = query(
    collection(db, 'tasks'),
    where('assignedEmployeeIds', 'array-contains', currentUid),
    orderBy('deadline', 'asc')
  );

  if (tasksListener) tasksListener();

  tasksListener = onSnapshot(q, (snapshot) => {
    const tasks = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMyTasks(tasks);
    renderUpcomingDeadlines(tasks);
    updateStats(tasks);
  }, (error) => {
    console.warn('Could not load tasks:', error);
    document.getElementById('myTasksList').innerHTML =
      '<p class="text-muted text-center py-3">لا توجد مهام مسندة إليك حالياً</p>';
  });
}

// =============================================================
// 4. عرض مهامي
// =============================================================
function renderMyTasks(tasks) {
  const container = document.getElementById('myTasksList');

  // فلترة المهام النشطة (ليست مكتملة أو ملغاة)
  const activeTasks = tasks.filter(
    (t) => !['completed', 'cancelled'].includes(t.status)
  );

  if (activeTasks.length === 0) {
    container.innerHTML = `
      <div class="text-center py-4">
        <i class="fas fa-check-circle fa-3x text-success mb-3"></i>
        <h5 class="text-muted">لا توجد مهام نشطة حالياً</h5>
        <p class="text-muted">استمتع بيومك! سيظهر هنا أي مهمة تُسند إليك.</p>
      </div>
    `;
    return;
  }

  let html = '';
  for (const task of activeTasks) {
    const days = daysUntil(task.deadline);
    const isOverdue = days !== null && days < 0 && task.status !== 'completed';
    const isUrgent = days !== null && days >= 0 && days <= 2;

    html += `
      <div class="task-card ${isOverdue ? 'overdue' : ''}">
        <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
          <div style="flex:1; min-width:200px;">
            <strong style="font-size:16px;">${escapeHtml(task.title || 'مهمة')}</strong>
            ${statusBadge(task.status)}
            ${isOverdue ? '<span class="task-status-badge ts-overdue">متأخرة</span>' : ''}
            ${isUrgent ? '<span class="task-status-badge ts-progress">عاجلة</span>' : ''}
            ${task.description ? `<div class="text-muted small mt-1">${escapeHtml(task.description.substring(0, 100))}${task.description.length > 100 ? '...' : ''}</div>` : ''}
            <div class="text-muted small mt-1">
              ${task.priority ? `<span class="priority-${task.priority}"><i class="fas fa-flag"></i> ${escapeHtml(task.priority)}</span> • ` : ''}
              <i class="fas fa-calendar"></i> ${formatDate(task.deadline)}
              ${days !== null ? ` (${days > 0 ? `${days} يوم متبقّي` : days === 0 ? 'اليوم' : `${Math.abs(days)} يوم متأخر`)})` : ''}
              ${task.compensation ? ` • <i class="fas fa-dollar-sign"></i> ${formatCurrency(task.compensation)}` : ''}
            </div>
          </div>
          <div class="d-flex gap-1">
            <button class="btn btn-sm btn-outline-primary view-task-btn" data-id="${task.id}">
              <i class="fas fa-eye"></i> عرض
            </button>
            ${task.status === 'in_progress' || task.status === 'assigned' || task.status === 'new' ?
              `<button class="btn btn-sm btn-outline-success update-progress-btn" data-id="${task.id}" data-action="progress">
                <i class="fas fa-arrow-up"></i> تحديث
              </button>` : ''}
            ${task.status === 'in_progress' ?
              `<button class="btn btn-sm btn-outline-info submit-review-btn" data-id="${task.id}">
                <i class="fas fa-paper-plane"></i> تسليم
              </button>` : ''}
          </div>
        </div>
        ${task.milestones && task.milestones.length > 0 ? `
          <div class="mt-2">
            <div class="d-flex justify-content-between small text-muted mb-1">
              <span>التقدّم</span>
              <span>${task.milestones.filter(m=>m.completed).length}/${task.milestones.length} مراحل</span>
            </div>
            <div class="progress" style="height:5px;">
              <div class="progress-bar bg-primary" style="width:${(task.milestones.filter(m=>m.completed).length / task.milestones.length * 100)}%"></div>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  container.innerHTML = html;

  // ربط الأحداث
  container.querySelectorAll('.view-task-btn').forEach((btn) => {
    btn.addEventListener('click', () => showTaskDetail(btn.dataset.id));
  });
  container.querySelectorAll('.update-progress-btn').forEach((btn) => {
    btn.addEventListener('click', () => updateTaskProgress(btn.dataset.id));
  });
  container.querySelectorAll('.submit-review-btn').forEach((btn) => {
    btn.addEventListener('click', () => submitForReview(btn.dataset.id));
  });
}

// =============================================================
// 5. المواعيد القادمة
// =============================================================
function renderUpcomingDeadlines(tasks) {
  const container = document.getElementById('upcomingDeadlines');

  const upcoming = tasks
    .filter((t) => !['completed', 'cancelled'].includes(t.status) && t.deadline)
    .map((t) => ({ ...t, daysUntil: daysUntil(t.deadline) }))
    .filter((t) => t.daysUntil !== null && t.daysUntil <= 7)
    .sort((a, b) => a.daysUntil - b.daysUntil);

  if (upcoming.length === 0) {
    container.innerHTML = `
      <div class="text-center py-3">
        <i class="fas fa-calendar-check fa-2x text-success mb-2"></i>
        <p class="text-muted mb-0">لا توجد مواعيد قريبة. أحسنت!</p>
      </div>
    `;
    return;
  }

  let html = '';
  for (const task of upcoming) {
    const cls = task.daysUntil < 0 ? 'text-danger' : task.daysUntil <= 2 ? 'text-warning' : 'text-muted';
    html += `
      <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
        <div>
          <strong>${escapeHtml(task.title || 'مهمة')}</strong>
          ${statusBadge(task.status)}
        </div>
        <div class="${cls} small">
          <i class="fas fa-clock"></i>
          ${task.daysUntil < 0 ? `متأخرة ${Math.abs(task.daysUntil)} يوم` :
            task.daysUntil === 0 ? 'اليوم!' :
            task.daysUntil === 1 ? 'غداً!' :
            `${task.daysUntil} أيام`}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

// =============================================================
// 6. تحديث الإحصائيات
// =============================================================
function updateStats(tasks) {
  const total = tasks.length;
  const inProgress = tasks.filter((t) => t.status === 'in_progress' || t.status === 'assigned' || t.status === 'new').length;
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const overdue = tasks.filter((t) => {
    if (['completed', 'cancelled'].includes(t.status)) return false;
    const d = daysUntil(t.deadline);
    return d !== null && d < 0;
  }).length;

  document.getElementById('statTotalTasks').textContent = total;
  document.getElementById('statInProgress').textContent = inProgress;
  document.getElementById('statCompleted').textContent = completed;
  document.getElementById('statOverdue').textContent = overdue;
}

// =============================================================
// 7. تحميل المستحقات (من employeeLedger)
// =============================================================
function loadEarnings() {
  const q = query(
    collection(db, 'employeeLedger'),
    where('employeeUid', '==', currentUid),
    orderBy('createdAt', 'desc')
  );

  if (ledgerListener) ledgerListener();

  ledgerListener = onSnapshot(q, (snapshot) => {
    const entries = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

    const approvedEarnings = entries
      .filter((e) => e.type === 'earning' && e.status === 'approved')
      .reduce((sum, e) => sum + (e.amount || 0), 0);

    const pendingEarnings = entries
      .filter((e) => e.type === 'earning' && e.status === 'pending')
      .reduce((sum, e) => sum + (e.amount || 0), 0);

    const deductions = entries
      .filter((e) => e.type === 'deduction' && e.status === 'approved')
      .reduce((sum, e) => sum + (e.amount || 0), 0);

    const bonuses = entries
      .filter((e) => e.type === 'bonus' && e.status === 'approved')
      .reduce((sum, e) => sum + (e.amount || 0), 0);

    const payouts = entries
      .filter((e) => e.type === 'payout' && e.status === 'approved')
      .reduce((sum, e) => sum + (e.amount || 0), 0);

    const netEarnings = approvedEarnings + bonuses - deductions - payouts;
    const outstanding = netEarnings; // المستحق غير المدفوع

    document.getElementById('statEarnings').textContent = formatCurrency(outstanding);

    renderEarningsSummary(entries, {
      approvedEarnings, pendingEarnings, deductions, bonuses, payouts, netEarnings,
    });
  }, (error) => {
    console.warn('Could not load earnings:', error);
    document.getElementById('earningsSummary').innerHTML =
      '<p class="text-muted text-center py-3">لا توجد مستحقات مسجلة بعد</p>';
  });
}

function renderEarningsSummary(entries, totals) {
  const container = document.getElementById('earningsSummary');
  const recent = entries.slice(0, 10);

  let html = `
    <div class="row mb-3">
      <div class="col-md-3 col-6">
        <div class="text-center">
          <div class="text-success fw-bold" style="font-size:20px;">${formatCurrency(totals.approvedEarnings)}</div>
          <small class="text-muted">أرباح معتمدة</small>
        </div>
      </div>
      <div class="col-md-3 col-6">
        <div class="text-center">
          <div class="text-warning fw-bold" style="font-size:20px;">${formatCurrency(totals.pendingEarnings)}</div>
          <small class="text-muted">قيد المراجعة</small>
        </div>
      </div>
      <div class="col-md-3 col-6">
        <div class="text-center">
          <div class="text-info fw-bold" style="font-size:20px;">${formatCurrency(totals.bonuses)}</div>
          <small class="text-muted">مكافآت</small>
        </div>
      </div>
      <div class="col-md-3 col-6">
        <div class="text-center">
          <div class="text-danger fw-bold" style="font-size:20px;">${formatCurrency(totals.deductions)}</div>
          <small class="text-muted">خصومات</small>
        </div>
      </div>
    </div>
    <div class="alert alert-info">
      <strong>صافي المستحق:</strong> ${formatCurrency(totals.netEarnings)}
      ${totals.payouts > 0 ? ` • <strong>مدفوع:</strong> ${formatCurrency(totals.payouts)}` : ''}
    </div>
  `;

  if (recent.length > 0) {
    html += '<h6 class="mt-3 mb-2">آخر الحركات</h6><div>';
    for (const e of recent) {
      const typeLabels = {
        earning: { label: 'ربح', cls: 'text-success', sign: '+' },
        deduction: { label: 'خصم', cls: 'text-danger', sign: '-' },
        bonus: { label: 'مكافأة', cls: 'text-info', sign: '+' },
        payout: { label: 'دفعة', cls: 'text-primary', sign: '-' },
      };
      const info = typeLabels[e.type] || typeLabels.earning;
      const statusBadge = e.status === 'approved' ?
        '<span class="badge bg-success ms-1">معتمد</span>' :
        e.status === 'pending' ?
          '<span class="badge bg-warning ms-1">معلّق</span>' :
          '<span class="badge bg-danger ms-1">مرفوض</span>';

      html += `
        <div class="d-flex justify-content-between py-2 border-bottom">
          <div>
            <strong>${info.label}</strong> ${statusBadge}
            ${e.reason ? `<div class="text-muted small">${escapeHtml(e.reason)}</div>` : ''}
            <div class="text-muted small">${formatDate(e.createdAt)}</div>
          </div>
          <div class="${info.cls} fw-bold">${info.sign}${formatCurrency(e.amount)}</div>
        </div>
      `;
    }
    html += '</div>';
  }

  container.innerHTML = html;
}

// =============================================================
// 8. تفاصيل المهمة + تحديث الحالة
// =============================================================
async function showTaskDetail(taskId) {
  try {
    const docSnap = await getDoc(doc(db, 'tasks', taskId));
    if (!docSnap.exists()) {
      showToast('المهمة غير موجودة', 'error');
      return;
    }
    const task = { id: docSnap.id, ...docSnap.data() };

    document.getElementById('taskDetailTitle').textContent = task.title || 'تفاصيل المهمة';

    let milestonesHtml = '';
    if (task.milestones && task.milestones.length > 0) {
      milestonesHtml = '<div class="mt-3"><h6>مراحل التنفيذ</h6>';
      task.milestones.forEach((m, i) => {
        milestonesHtml += `
          <div class="form-check">
            <input class="form-check-input milestone-check" type="checkbox" data-index="${i}"
              ${m.completed ? 'checked' : ''} ${task.status === 'completed' ? 'disabled' : ''}>
            <label class="form-check-label">${escapeHtml(m.name || m.stage || `مرحلة ${i+1}`)}</label>
            ${m.completedAt ? `<small class="text-muted"> — ${formatDate(m.completedAt)}</small>` : ''}
          </div>
        `;
      });
      milestonesHtml += '</div>';
    }

    let commentsHtml = '';
    if (task.comments && task.comments.length > 0) {
      commentsHtml = '<div class="mt-3"><h6>التعليقات</h6>';
      task.comments.forEach((c) => {
        commentsHtml += `
          <div class="border-bottom py-2">
            <strong>${escapeHtml(c.userName || 'مستخدم')}</strong>
            <small class="text-muted"> ${formatDate(c.createdAt)}</small>
            <div>${escapeHtml(c.text)}</div>
          </div>
        `;
      });
      commentsHtml += '</div>';
    }

    document.getElementById('taskDetailBody').innerHTML = `
      <div class="mb-3">
        ${statusBadge(task.status)}
        ${task.priority ? `<span class="priority-${task.priority} ms-2"><i class="fas fa-flag"></i> ${escapeHtml(task.priority)}</span>` : ''}
        ${task.compensation ? `<span class="ms-2"><i class="fas fa-dollar-sign"></i> ${formatCurrency(task.compensation)}</span>` : ''}
      </div>
      ${task.description ? `<div class="mb-3"><h6>الوصف</h6><p>${escapeHtml(task.description)}</p></div>` : ''}
      <div class="row mb-3">
        <div class="col-md-6">
          <strong>الموعد النهائي:</strong> ${formatDate(task.deadline)}
        </div>
        <div class="col-md-6">
          <strong>الطلب المرتبط:</strong> ${task.orderId ? `#${escapeHtml(task.orderId.substring(0,8))}` : 'لا يوجد'}
        </div>
      </div>
      ${milestonesHtml}
      ${commentsHtml}
      <div class="mt-3">
        <h6>إضافة تعليق</h6>
        <textarea class="form-control" id="newCommentText" rows="2" placeholder="اكتب تعليقك..."></textarea>
        <button class="btn btn-sm btn-primary mt-2" id="addCommentBtn" data-task-id="${taskId}">
          <i class="fas fa-comment me-1"></i>إضافة
        </button>
      </div>
    `;

    // ربط أحداث المراحل والتعليقات
    document.querySelectorAll('.milestone-check').forEach((cb) => {
      cb.addEventListener('change', () => toggleMilestone(taskId, task, parseInt(cb.dataset.index)));
    });
    document.getElementById('addCommentBtn')?.addEventListener('click', () => addComment(taskId));

    const modal = new bootstrap.Modal(document.getElementById('taskDetailModal'));
    modal.show();
  } catch (error) {
    console.error('Error loading task:', error);
    showToast('تعذّر تحميل المهمة', 'error');
  }
}

// =============================================================
// 9. تحديث حالة المهمة
// =============================================================
async function updateTaskProgress(taskId) {
  try {
    const { updateDoc, doc } = await import('firebase/firestore');
    await updateDoc(doc(db, 'tasks', taskId), {
      status: 'in_progress',
      updatedAt: new Date().toISOString(),
    });
    showToast('تم تحديث حالة المهمة إلى «قيد التنفيذ»', 'success');
  } catch (error) {
    showToast('تعذّر تحديث المهمة: ' + error.message, 'error');
  }
}

async function submitForReview(taskId) {
  const result = await Swal.fire({
    title: 'تسليم المهمة للمراجعة؟',
    text: 'سيتم تحويل المهمة إلى حالة «قيد المراجعة» ليطلع عليها المدير.',
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'نعم، سلّم',
    cancelButtonText: 'إلغاء',
    confirmButtonColor: '#17a2b8',
  });

  if (!result.isConfirmed) return;

  try {
    const { updateDoc, doc } = await import('firebase/firestore');
    await updateDoc(doc(db, 'tasks', taskId), {
      status: 'under_review',
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    showToast('تم تسليم المهمة للمراجعة', 'success');
  } catch (error) {
    showToast('تعذّر تسليم المهمة', 'error');
  }
}

async function toggleMilestone(taskId, task, index) {
  if (!task.milestones || !task.milestones[index]) return;

  const milestones = [...task.milestones];
  milestones[index].completed = !milestones[index].completed;
  milestones[index].completedAt = milestones[index].completed ? new Date().toISOString() : null;

  // حساب نسبة الإنجاز
  const completed = milestones.filter((m) => m.completed).length;
  const completionRate = Math.round((completed / milestones.length) * 100);

  try {
    const { updateDoc, doc } = await import('firebase/firestore');
    await updateDoc(doc(db, 'tasks', taskId), {
      milestones,
      completionRate,
      updatedAt: new Date().toISOString(),
    });
    showToast('تم تحديث المرحلة', 'success');
  } catch (error) {
    showToast('تعذّر تحديث المرحلة', 'error');
  }
}

async function addComment(taskId) {
  const text = document.getElementById('newCommentText').value.trim();
  if (!text) {
    showToast('اكتب تعليقًا أولاً', 'warning');
    return;
  }

  const userData = getUserData();
  const comment = {
    userId: currentUid,
    userName: userData?.email || userData?.displayName || 'موظف',
    text,
    createdAt: new Date().toISOString(),
  };

  try {
    const { getDoc, doc, updateDoc } = await import('firebase/firestore');
    const docSnap = await getDoc(doc(db, 'tasks', taskId));
    if (!docSnap.exists()) return;

    const task = docSnap.data();
    const comments = task.comments || [];
    comments.push(comment);

    await updateDoc(doc(db, 'tasks', taskId), {
      comments,
      updatedAt: new Date().toISOString(),
    });

    showToast('تم إضافة التعليق', 'success');
    document.getElementById('newCommentText').value = '';
    showTaskDetail(taskId); // إعادة عرض التفاصيل
  } catch (error) {
    showToast('تعذّر إضافة التعليق', 'error');
  }
}

console.log('✅ employee-dashboard.js loaded');
