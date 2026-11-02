// =============================================================
// init.js — التهيئة المشتركة لكل صفحات الإدارة
// =============================================================
// يقلّل التكرار في كل وحدات الصفحات:
// - تهيئة المصادقة
// - تهيئة الصلاحيات
// - تحديث بيانات المستخدم في القائمة
// - الوضع المظلم
// - القائمة الجانبية
// - تسجيل الخروج
//
// الاستخدام:
//   import { initPage } from '../init.js';
//   initPage({ onReady: (user) => { /* كود الصفحة */ } });
// =============================================================

import { onAuthStateChangedCallback, logoutUser } from './auth.js';
import {
  initPermissions, stopPermissions, getUserData, isAdmin,
} from './permissions.js';

// =============================================================
// 1. تهيئة الصفحة — تُستدعى في بداية كل وحدة
// =============================================================
export function initPage(options = {}) {
  onAuthStateChangedCallback(async (user) => {
    if (!user) {
      window.location.href = (options.loginUrl || '../login.html');
      return;
    }

    // تهيئة الصلاحيات (يبدأ الاستماع لوثيقة المستخدم)
    initPermissions(user);

    // تحديث بيانات المستخدم في القائمة الجانبية
    updateSidebarUserInfo(user);

    // تهيئة الوضع المظلم والقائمة الجانبية
    initDarkMode();
    initSidebar();

    // زر تسجيل الخروج
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        stopPermissions();
        try {
          await logoutUser();
        } catch (e) {
          console.error('Logout error:', e);
        }
        window.location.href = (options.loginUrl || '../login.html');
      });
    }

    // استدعاء دالة جاهزية الصفحة إن وُجدت
    if (options.onReady && typeof options.onReady === 'function') {
      options.onReady(user, getUserData());
    }
  });
}

// =============================================================
// 2. تحديث بيانات المستخدم في القائمة الجانبية
// =============================================================
function updateSidebarUserInfo(user) {
  const sidebarUserName = document.getElementById('sidebarUserName');
  const sidebarUserEmail = document.getElementById('sidebarUserEmail');
  const sidebarAvatar = document.getElementById('sidebarAvatar');

  if (sidebarUserName) {
    sidebarUserName.textContent = user.displayName || user.email;
  }
  if (sidebarUserEmail) {
    sidebarUserEmail.textContent = user.email;
  }
  if (sidebarAvatar) {
    sidebarAvatar.textContent = user.displayName
      ? user.displayName.charAt(0).toUpperCase()
      : user.email.charAt(0).toUpperCase();
  }
}

// =============================================================
// 3. الوضع المظلم
// =============================================================
function initDarkMode() {
  const themeToggle = document.getElementById('themeToggle');
  const htmlElement = document.documentElement;
  const savedTheme = localStorage.getItem('theme') || 'light';

  if (savedTheme === 'dark') {
    htmlElement.setAttribute('data-theme', 'dark');
    if (themeToggle) themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
  } else {
    htmlElement.removeAttribute('data-theme');
    if (themeToggle) themeToggle.innerHTML = '<i class="fas fa-moon"></i>';
  }

  if (themeToggle) {
    // إزالة المستمعين السابقين لتفادي التراكم
    const newToggle = themeToggle.cloneNode(true);
    themeToggle.parentNode.replaceChild(newToggle, themeToggle);
    newToggle.addEventListener('click', function () {
      const currentTheme = htmlElement.getAttribute('data-theme');
      if (currentTheme === 'dark') {
        htmlElement.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
        this.innerHTML = '<i class="fas fa-moon"></i>';
      } else {
        htmlElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
        this.innerHTML = '<i class="fas fa-sun"></i>';
      }
    });
  }
}

// =============================================================
// 4. القائمة الجانبية للجوال
// =============================================================
function initSidebar() {
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('active');
      if (overlay) overlay.classList.toggle('active');
    });
  }

  if (overlay) {
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('active');
      overlay.classList.remove('active');
    });
  }
}

// =============================================================
// 5. دوال مساعدة عامة (مشتركة بين الصفحات)
// =============================================================
export function formatCurrency(amount, currency = '$') {
  if (amount === undefined || amount === null || isNaN(amount)) {
    return `${currency}0.00`;
  }
  return `${currency}${Number(amount).toFixed(2)}`;
}

export function formatDate(date) {
  if (!date) return '-';
  if (date.toDate && typeof date.toDate === 'function') {
    date = date.toDate();
  }
  if (date instanceof Date) return date.toISOString().slice(0, 10);
  if (typeof date === 'string') return date.slice(0, 10);
  return '-';
}

export function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

export function showToast(message, type = 'success') {
  const colors = {
    success: 'linear-gradient(to right, #00b09b, #96c93d)',
    error: 'linear-gradient(to right, #ff5f6d, #ffc371)',
    warning: 'linear-gradient(to right, #f7971e, #ffd200)',
    info: 'linear-gradient(to right, #ff6600, #ff8533)',
  };
  if (typeof Toastify !== 'undefined') {
    Toastify({
      text: message,
      duration: 3000,
      gravity: 'bottom',
      position: 'left',
      style: { background: colors[type] || colors.info },
      className: 'rounded-3 shadow',
    }).showToast();
  } else {
    console.log(message);
  }
}

export function safeDate(date) {
  if (!date) return null;
  if (date.toDate && typeof date.toDate === 'function') return date.toDate();
  if (date instanceof Date) return date;
  if (typeof date === 'string') return new Date(date);
  return null;
}

console.log('✅ init.js loaded — shared initialization ready');
