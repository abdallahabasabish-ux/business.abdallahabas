// =============================================================
// settings.js — مُحدَّث مع نظام الصلاحيات الكامل
// =============================================================
// التغييرات:
// 1. استخدام systemSettings بدل adminEmails الثابت
// 2. إدارة خريطة صلاحيات لكل مستخدم
// 3. واجهة لتحرير الصلاحيات بصرية
// 4. حذف createUserWithEmailAndPassword المباشر (يُسبق المدير)
// =============================================================

import { onAuthStateChangedCallback, logoutUser } from '../auth.js';
import { auth, db } from '../firebase-config.js';
import {
  collection, doc, getDocs, getDoc, setDoc, updateDoc,
  deleteDoc, onSnapshot, query, orderBy,
} from 'firebase/firestore';
import {
  requireAdmin, PERMISSIONS, getDefaultPermissions, getUserData,
} from '../permissions.js';
import { initPage, formatDate, escapeHtml, showToast } from '../init.js';

const state = {
  users: [],
  currentUser: null,
  settings: {},
  usersListener: null,
};

let addUserModalInstance = null;
let permissionsModalInstance = null;

// =============================================================
// 1. التهيئة
// =============================================================
initPage({
  onReady: async (user, userData) => {
    // هذه الصفحة للمدير فقط
    if (!requireAdmin()) return;

    // إظهار المحتوى
    const content = document.getElementById('settingsContent');
    const unauthorized = document.getElementById('unauthorizedMessage');
    if (content) content.style.display = 'block';
    if (unauthorized) unauthorized.style.display = 'none';

    // تهيئة المودالات
    const addUserModal = document.getElementById('addUserModal');
    if (addUserModal) addUserModalInstance = new bootstrap.Modal(addUserModal);

    const permissionsModal = document.getElementById('permissionsModal');
    if (permissionsModal) permissionsModalInstance = new bootstrap.Modal(permissionsModal);

    // ربط الأحداث
    document.getElementById('addUserBtn')?.addEventListener('click', () => {
      document.getElementById('addUserForm').reset();
      if (addUserModalInstance) addUserModalInstance.show();
    });

    document.getElementById('saveNewUserBtn')?.addEventListener('click', handleAddUser);
    document.getElementById('settingsForm')?.addEventListener('submit', handleSaveSettings);
    document.getElementById('savePermissionsBtn')?.addEventListener('click', savePermissions);

    // تحميل البيانات
    loadUsers();
    loadSettings();
  },
});

// =============================================================
// 2. تحميل المستخدمين (Realtime)
// =============================================================
function loadUsers() {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  if (state.usersListener) {
    state.usersListener();
    state.usersListener = null;
  }

  try {
    const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    state.usersListener = onSnapshot(
      q,
      (snapshot) => {
        state.users = snapshot.docs.map((d) => ({ uid: d.id, ...d.data() }));
        renderUsersTable(state.users);
      },
      (error) => {
        console.error('Error listening to users:', error);
        showToast('حدث خطأ في تحميل المستخدمين', 'error');
      }
    );
  } catch (error) {
    console.error('Error loading users:', error);
  }
}

// =============================================================
// 3. عرض جدول المستخدمين (مع زر الصلاحيات)
// =============================================================
function renderUsersTable(users) {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  if (!users || users.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="6" class="text-center text-muted py-4">
        <i class="fas fa-users fa-2x mb-2 d-block"></i>
        لا يوجد مستخدمين
      </td></tr>
    `;
    return;
  }

  let html = '';
  users.forEach((u) => {
    const isCurrentUser = u.uid === auth.currentUser?.uid;
    const statusBadge = u.disabled
      ? '<span class="badge bg-danger">معطل</span>'
      : '<span class="badge bg-success">نشط</span>';

    const roleBadge = u.role === 'مدير'
      ? '<span class="badge bg-warning text-dark">مدير</span>'
      : u.role === 'محاسب'
        ? '<span class="badge bg-info text-dark">محاسب</span>'
        : u.role === 'مشرف'
          ? '<span class="badge bg-primary">مشرف</span>'
          : '<span class="badge bg-secondary">موظف</span>';

    html += `
      <tr>
        <td>
          <div class="d-flex align-items-center gap-2">
            <div style="width:32px;height:32px;border-radius:50%;background:var(--color-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">
              ${(u.email || 'م').charAt(0).toUpperCase()}
            </div>
            <span>${escapeHtml(u.email || '')}</span>
          </div>
        </td>
        <td>${roleBadge}</td>
        <td>${statusBadge}</td>
        <td>${formatDate(u.createdAt)}</td>
        <td>
          <div class="d-flex gap-1 flex-wrap">
            <button class="btn btn-sm btn-outline-primary edit-user-btn" data-uid="${u.uid}" title="تعديل الدور">
              <i class="fas fa-user-edit"></i>
            </button>
            <button class="btn btn-sm btn-outline-info permissions-user-btn" data-uid="${u.uid}" title="الصلاحيات">
              <i class="fas fa-shield-alt"></i>
            </button>
            ${!isCurrentUser ? `
              <button class="btn btn-sm btn-outline-${u.disabled ? 'success' : 'warning'} toggle-user-btn"
                      data-uid="${u.uid}" data-disabled="${u.disabled ? 'true' : 'false'}"
                      title="${u.disabled ? 'تفعيل' : 'تعطيل'}">
                <i class="fas fa-${u.disabled ? 'check-circle' : 'ban'}"></i>
              </button>
              <button class="btn btn-sm btn-outline-danger delete-user-btn" data-uid="${u.uid}" title="حذف">
                <i class="fas fa-trash"></i>
              </button>
            ` : '<span class="text-muted small">(أنت)</span>'}
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;

  // ربط الأحداث
  tbody.querySelectorAll('.edit-user-btn').forEach((btn) => {
    btn.addEventListener('click', () => openEditRoleModal(btn.dataset.uid));
  });
  tbody.querySelectorAll('.permissions-user-btn').forEach((btn) => {
    btn.addEventListener('click', () => openPermissionsModal(btn.dataset.uid));
  });
  tbody.querySelectorAll('.toggle-user-btn').forEach((btn) => {
    btn.addEventListener('click', () => toggleUserStatus(btn.dataset.uid, btn.dataset.disabled === 'true'));
  });
  tbody.querySelectorAll('.delete-user-btn').forEach((btn) => {
    btn.addEventListener('click', () => confirmDeleteUser(btn.dataset.uid));
  });
}

// =============================================================
// 4. تعديل دور المستخدم
// =============================================================
function openEditRoleModal(uid) {
  const user = state.users.find((u) => u.uid === uid);
  if (!user) {
    showToast('المستخدم غير موجود', 'error');
    return;
  }

  Swal.fire({
    title: 'تعديل دور المستخدم',
    html: `
      <div class="text-start">
        <p><strong>البريد:</strong> ${escapeHtml(user.email)}</p>
        <p><strong>الدور الحالي:</strong> ${escapeHtml(user.role || 'موظف')}</p>
        <hr>
        <div class="form-group">
          <label for="newRoleSelect" class="form-label">الدور الجديد</label>
          <select id="newRoleSelect" class="form-select">
            <option value="مدير" ${user.role === 'مدير' ? 'selected' : ''}>مدير</option>
            <option value="محاسب" ${user.role === 'محاسب' ? 'selected' : ''}>محاسب</option>
            <option value="مشرف" ${user.role === 'مشرف' ? 'selected' : ''}>مشرف</option>
            <option value="موظف" ${user.role === 'موظف' ? 'selected' : ''}>موظف</option>
          </select>
        </div>
        <div class="form-check mt-2">
          <input type="checkbox" class="form-check-input" id="applyDefaults"
            ${!user.permissions ? 'checked' : ''}>
          <label class="form-check-label" for="applyDefaults">
            تطبيق الصلاحيات الافتراضية لهذا الدور
          </label>
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'حفظ',
    cancelButtonText: 'إلغاء',
    confirmButtonColor: '#ff6600',
    preConfirm: () => {
      return {
        role: document.getElementById('newRoleSelect').value,
        applyDefaults: document.getElementById('applyDefaults').checked,
      };
    },
  }).then(async (result) => {
    if (result.isConfirmed && result.value) {
      try {
        const updateData = {
          role: result.value.role,
          updatedAt: new Date().toISOString(),
        };

        if (result.value.applyDefaults) {
          updateData.permissions = getDefaultPermissions(result.value.role);
        }

        await updateDoc(doc(db, 'users', uid), updateData);
        showToast('تم تحديث دور المستخدم بنجاح', 'success');
      } catch (error) {
        console.error('Error updating role:', error);
        showToast('تعذّر تحديث الدور: ' + error.message, 'error');
      }
    }
  });
}

// =============================================================
// 5. تحرير الصلاحيات الدقيقة
// =============================================================
function openPermissionsModal(uid) {
  const user = state.users.find((u) => u.uid === uid);
  if (!user) {
    showToast('المستخدم غير موجود', 'error');
    return;
  }

  if (user.role === 'مدير') {
    showToast('المدير يملك كل الصلاحيات تلقائيًا', 'info');
    return;
  }

  state.currentUser = user;

  // توليد HTML للصلاحيات
  const permissionsList = document.getElementById('permissionsList');
  if (!permissionsList) return;

  const groups = {};
  for (const [key, perm] of Object.entries(PERMISSIONS)) {
    if (!groups[perm.group]) groups[perm.group] = [];
    groups[perm.group].push({ key, ...perm });
  }

  let html = '';
  for (const [group, perms] of Object.entries(groups)) {
    html += `<div class="mb-3"><h6 class="text-muted">${escapeHtml(group)}</h6>`;
    perms.forEach((p) => {
      const checked = user.permissions?.[p.key] ? 'checked' : '';
      html += `
        <div class="form-check">
          <input class="form-check-input perm-checkbox" type="checkbox"
                 id="perm_${p.key}" data-perm="${p.key}" ${checked}>
          <label class="form-check-label" for="perm_${p.key}">
            ${escapeHtml(p.label)}
          </label>
        </div>
      `;
    });
    html += '</div>';
  }

  permissionsList.innerHTML = html;

  // تحديث عنوان المودال
  const title = document.getElementById('permissionsModalTitle');
  if (title) title.textContent = `صلاحيات: ${user.email}`;

  if (permissionsModalInstance) permissionsModalInstance.show();
}

// =============================================================
// 6. حفظ الصلاحيات
// =============================================================
async function savePermissions() {
  if (!state.currentUser) return;

  const checkboxes = document.querySelectorAll('.perm-checkbox');
  const permissions = {};
  checkboxes.forEach((cb) => {
    permissions[cb.dataset.perm] = cb.checked;
  });

  try {
    await updateDoc(doc(db, 'users', state.currentUser.uid), {
      permissions,
      updatedAt: new Date().toISOString(),
    });
    showToast('تم حفظ الصلاحيات بنجاح', 'success');
    if (permissionsModalInstance) permissionsModalInstance.hide();
  } catch (error) {
    console.error('Error saving permissions:', error);
    showToast('تعذّر حفظ الصلاحيات: ' + error.message, 'error');
  }
}

// =============================================================
// 7. تبديل حالة المستخدم
// =============================================================
async function toggleUserStatus(uid, currentlyDisabled) {
  const user = state.users.find((u) => u.uid === uid);
  if (!user) return;

  const newStatus = !currentlyDisabled;
  const action = newStatus ? 'تعطيل' : 'تفعيل';

  const result = await Swal.fire({
    title: `${action} المستخدم؟`,
    html: `<p>هل أنت متأكد من <strong>${action}</strong> المستخدم: <strong>${escapeHtml(user.email)}</strong>?</p>`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'نعم',
    cancelButtonText: 'إلغاء',
    confirmButtonColor: newStatus ? '#dc3545' : '#28a745',
  });

  if (result.isConfirmed) {
    try {
      await updateDoc(doc(db, 'users', uid), {
        disabled: newStatus,
        updatedAt: new Date().toISOString(),
      });
      showToast(`تم ${action} المستخدم`, 'success');
    } catch (error) {
      showToast('تعذّر تغيير الحالة', 'error');
    }
  }
}

// =============================================================
// 8. حذف مستخدم
// =============================================================
async function confirmDeleteUser(uid) {
  const user = state.users.find((u) => u.uid === uid);
  if (!user) return;

  const result = await Swal.fire({
    title: '⚠️ حذف المستخدم',
    html: `
      <p>سيتم حذف: <strong>${escapeHtml(user.email)}</strong></p>
      <p class="text-danger"><small>لا يمكن التراجع. يجب حذف حساب Firebase Auth يدويًا من الوحدة التحكم.</small></p>
    `,
    icon: 'error',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    confirmButtonText: 'نعم، احذف',
    cancelButtonText: 'إلغاء',
  });

  if (result.isConfirmed) {
    try {
      await deleteDoc(doc(db, 'users', uid));
      showToast('تم حذف المستخدم من قاعدة البيانات', 'success');
    } catch (error) {
      showToast('تعذّر الحذف', 'error');
    }
  }
}

// =============================================================
// 9. إضافة مستخدم جديد (مُحدَّث)
// =============================================================
// ملاحظة: createUserWithEmailAndPassword يُسبق المستخدم الحالي
// بدون Cloud Functions، الحل: تعطيل هذا الزر وتوجيه المدير
// لإنشاء المستخدم من صفحة الدخول، ثم تعيين دوره هنا.
async function handleAddUser() {
  const email = document.getElementById('newUserEmail')?.value.trim();
  const role = document.getElementById('newUserRole')?.value;

  if (!email || !role) {
    showToast('البريد والدور مطلوبان', 'warning');
    return;
  }

  showToast('بدون Cloud Functions، اطلب من المستخدم التسجيل من صفحة الدخول، ثم عيّن دوره من هذا الجدول.', 'info');
  if (addUserModalInstance) addUserModalInstance.hide();
}

// =============================================================
// 10. تحميل الإعدادات
// =============================================================
async function loadSettings() {
  try {
    const settingsDoc = await getDoc(doc(db, 'settings', 'general'));
    if (settingsDoc.exists()) {
      state.settings = settingsDoc.data();
      const data = state.settings;

      const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
      set('companyName', data.companyName);
      set('companyLogo', data.companyLogo);
      set('companyPhone', data.companyPhone);
      set('companyEmail', data.companyEmail);
      set('companyAddress', data.companyAddress);
      set('currency', data.currency || '$');
      set('taxRate', data.taxRate || 0);
      set('timezone', data.timezone || 'Asia/Riyadh');
      const notifEl = document.getElementById('enableNotifications');
      if (notifEl) notifEl.checked = data.enableNotifications || false;
    } else {
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
      set('currency', '$');
      set('taxRate', 0);
      set('timezone', 'Asia/Riyadh');
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

// =============================================================
// 11. حفظ الإعدادات
// =============================================================
async function handleSaveSettings(e) {
  e.preventDefault();

  const data = {
    companyName: document.getElementById('companyName')?.value.trim() || '',
    companyLogo: document.getElementById('companyLogo')?.value.trim() || '',
    companyPhone: document.getElementById('companyPhone')?.value.trim() || '',
    companyEmail: document.getElementById('companyEmail')?.value.trim() || '',
    companyAddress: document.getElementById('companyAddress')?.value.trim() || '',
    currency: document.getElementById('currency')?.value.trim() || '$',
    taxRate: parseFloat(document.getElementById('taxRate')?.value) || 0,
    timezone: document.getElementById('timezone')?.value || 'Asia/Riyadh',
    enableNotifications: document.getElementById('enableNotifications')?.checked || false,
    updatedAt: new Date().toISOString(),
  };

  const saveBtn = document.getElementById('saveSettingsBtn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>جاري الحفظ...';
  }

  try {
    await setDoc(doc(db, 'settings', 'general'), data, { merge: true });
    state.settings = { ...state.settings, ...data };
    showToast('تم حفظ الإعدادات بنجاح', 'success');
  } catch (error) {
    console.error('Error saving settings:', error);
    showToast('تعذّر حفظ الإعدادات', 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fas fa-save me-2"></i>حفظ الإعدادات';
    }
  }
}

// =============================================================
// 12. إعادة تعيين المودال
// =============================================================
const modalEl = document.getElementById('addUserModal');
if (modalEl) {
  modalEl.addEventListener('hidden.bs.modal', () => {
    const form = document.getElementById('addUserForm');
    if (form) form.reset();
  });
}

console.log('✅ settings.js loaded (with permissions management)');
