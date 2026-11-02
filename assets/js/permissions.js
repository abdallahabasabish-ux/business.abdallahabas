// =============================================================
// permissions.js — وحدة الصلاحيات الموحّدة
// =============================================================
// تقرأ وثيقة المستخدم من مجموعة users وتوفّر دوال التحقق
// تستمع للتغييرات فوريًا (Realtime) لتطبيق الصلاحيات ديناميكيًا
//
// الأمان الحقيقي في قواعد Firestore — هذه الوحدة للتحكم بالواجهة فقط
// =============================================================

import { db } from './firebase-config.js';
import { doc, onSnapshot } from 'firebase/firestore';

// =============================================================
// 1. الحالة الداخلية
// =============================================================
let currentUserData = null;
let currentAuthUser = null;
let unsubListener = null;

// =============================================================
// 2. تعريف الصلاحيات المتاحة في النظام
// =============================================================
export const PERMISSIONS = {
  canViewCustomers:    { label: 'عرض العملاء',          group: 'العملاء',     defaultForStaff: true },
  canAddCustomers:     { label: 'إضافة عملاء',          group: 'العملاء',     defaultForStaff: true },
  canEditCustomers:    { label: 'تعديل العملاء',        group: 'العملاء',     defaultForStaff: false },
  canViewOrders:       { label: 'عرض الطلبات',          group: 'الطلبات',     defaultForStaff: true },
  canCreateOrders:     { label: 'إنشاء طلبات',          group: 'الطلبات',     defaultForStaff: true },
  canUpdateOrders:     { label: 'تحديث الطلبات',        group: 'الطلبات',     defaultForStaff: false },
  canViewEmployees:    { label: 'عرض الموظفين',         group: 'الموظفين',    defaultForStaff: false },
  canViewInquiries:    { label: 'عرض الاستفسارات',     group: 'الاستفسارات', defaultForStaff: true },
  canEditInquiries:    { label: 'تعديل الاستفسارات',   group: 'الاستفسارات', defaultForStaff: false },
  canViewTasks:        { label: 'عرض المهام',           group: 'المهام',      defaultForStaff: true },
  canAssignTasks:      { label: 'تعيين المهام',         group: 'المهام',      defaultForStaff: false },
  canViewInvoices:     { label: 'عرض الفواتير',         group: 'الفواتير',    defaultForStaff: false },
  canViewPayments:     { label: 'عرض المدفوعات',        group: 'المدفوعات',   defaultForStaff: false },
  canViewReports:      { label: 'عرض التقارير',         group: 'التقارير',    defaultForStaff: false },
  canViewTreasury:     { label: 'عرض الخزينة',          group: 'المالية',     defaultForStaff: false },
};

// =============================================================
// 3. تهيئة الصلاحيات — تُستدعى عند تسجيل الدخول
// =============================================================
export function initPermissions(user) {
  currentAuthUser = user;

  // إيقاف المستمع السابق إن وجد
  if (unsubListener) {
    unsubListener();
    unsubListener = null;
  }

  // الاستماع لوثيقة المستخدم في مجموعة users
  // تحديثات فورية: إذا غيّر المدير دور/صلاحيات مستخدم، تنعكس فورًا
  unsubListener = onSnapshot(
    doc(db, 'users', user.uid),
    (docSnap) => {
      if (docSnap.exists()) {
        currentUserData = { uid: docSnap.id, ...docSnap.data() };
      } else {
        // المستخدم موجود في Auth لكن لا يملك وثيقة في users
        // نعامله كموظف افتراضي (القواعد ستسمح بإنشاء وثيقته)
        currentUserData = {
          uid: user.uid,
          email: user.email,
          role: 'موظف',
          permissions: {},
        };
      }

      // إشعار الواجهة بتحديث الصلاحيات
      window.dispatchEvent(
        new CustomEvent('permissionsUpdated', { detail: currentUserData })
      );

      // تطبيق الصلاحيات على القائمة والأزرار
      applyPermissionsToUI();
    },
    (error) => {
      console.warn('⚠️ Could not load user permissions:', error);
      currentUserData = {
        uid: user.uid,
        email: user.email,
        role: 'موظف',
        permissions: {},
      };
      applyPermissionsToUI();
    }
  );
}

// =============================================================
// 4. إيقاف الصلاحيات — تُستدعى عند تسجيل الخروج
// =============================================================
export function stopPermissions() {
  if (unsubListener) {
    unsubListener();
    unsubListener = null;
  }
  currentUserData = null;
  currentAuthUser = null;
}

// =============================================================
// 5. دوال التحقق
// =============================================================

// هل المستخدم مدير؟
export function isAdmin() {
  return currentUserData?.role === 'مدير';
}

// هل المستخدم محاسب أو مدير؟
export function isAccountant() {
  return currentUserData?.role === 'مدير' || currentUserData?.role === 'محاسب';
}

// هل المستخدم موظف نظامي (أي دور)؟
export function isStaff() {
  return ['مدير', 'محاسب', 'مشرف', 'موظف'].includes(currentUserData?.role);
}

// دور المستخدم الحالي
export function userRole() {
  return currentUserData?.role || 'موظف';
}

// التحقق من صلاحية مخصصة
export function hasPermission(perm) {
  if (!currentUserData) return false;
  if (currentUserData.role === 'مدير') return true;
  if (!currentUserData.permissions) return false;
  return currentUserData.permissions[perm] === true;
}

// بيانات المستخدم الكاملة
export function getUserData() {
  return currentUserData;
}

// معرّف المستخدم الحالي (للربط مع customerUid)
export function getCurrentUid() {
  return currentAuthUser?.uid || null;
}

// =============================================================
// 6. تطبيق الصلاحيات على واجهة المستخدم
// =============================================================
export function applyPermissionsToUI() {
  // 6.1 إظهار/إخفاء عناصر القائمة الجانبية
  document.querySelectorAll('[data-permission]').forEach((el) => {
    const perm = el.dataset.permission;
    if (isAdmin() || hasPermission(perm)) {
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  });

  // 6.2 إظهار/إخفاء أزرار الإجراءات
  document.querySelectorAll('[data-action-permission]').forEach((el) => {
    const perm = el.dataset.actionPermission;
    if (isAdmin() || hasPermission(perm)) {
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  });

  // 6.3 تحديث عرض دور المستخدم في القائمة الجانبية
  const roleDisplay = document.getElementById('sidebarUserRole');
  if (roleDisplay && currentUserData) {
    const roleLabels = {
      'مدير': 'مدير النظام',
      'محاسب': 'محاسب',
      'مشرف': 'مشرف',
      'موظف': 'موظف',
    };
    roleDisplay.textContent = roleLabels[currentUserData.role] || currentUserData.role;
  }

  // 6.4 إظهار شارة الدور
  const roleBadge = document.getElementById('sidebarRoleBadge');
  if (roleBadge && currentUserData) {
    const badgeClasses = {
      'مدير': 'badge bg-warning text-dark',
      'محاسب': 'badge bg-info text-dark',
      'مشرف': 'badge bg-primary',
      'موظف': 'badge bg-secondary',
    };
    roleBadge.className = badgeClasses[currentUserData.role] || 'badge bg-secondary';
    roleBadge.textContent = currentUserData.role || 'موظف';
  }
}

// =============================================================
// 7. توليد خريطة الصلاحيات الافتراضية للأدوار
// =============================================================
export function getDefaultPermissions(role) {
  const defaults = {};
  for (const [key, perm] of Object.entries(PERMISSIONS)) {
    if (role === 'مدير') {
      defaults[key] = true;
    } else if (role === 'محاسب') {
      // المحاسب: صلاحيات مالية + قراءة عامة
      defaults[key] = ['canViewCustomers', 'canViewOrders', 'canViewInvoices',
                       'canViewPayments', 'canViewTreasury', 'canViewReports',
                       'canViewInquiries'].includes(key);
    } else if (role === 'مشرف') {
      // المشرف: صلاحيات تشغيلية
      defaults[key] = ['canViewCustomers', 'canAddCustomers', 'canEditCustomers',
                       'canViewOrders', 'canCreateOrders', 'canUpdateOrders',
                       'canViewEmployees', 'canViewInquiries', 'canEditInquiries',
                       'canViewTasks', 'canAssignTasks'].includes(key);
    } else {
      // الموظف العادي: صلاحيات أساسية فقط
      defaults[key] = perm.defaultForStaff || false;
    }
  }
  return defaults;
}

// =============================================================
// 8. التحقق من الصلاحية مع إعادة توجيه (للصفحات المحمية)
// =============================================================
export function requirePermission(perm, redirectUrl = 'dashboard.html') {
  if (!hasPermission(perm) && !isAdmin()) {
    window.location.href = redirectUrl;
    return false;
  }
  return true;
}

export function requireAdmin(redirectUrl = 'dashboard.html') {
  if (!isAdmin()) {
    window.location.href = redirectUrl;
    return false;
  }
  return true;
}

export function requireAccountant(redirectUrl = 'dashboard.html') {
  if (!isAccountant()) {
    window.location.href = redirectUrl;
    return false;
  }
  return true;
}

console.log('✅ permissions.js loaded — unified permission system ready');
