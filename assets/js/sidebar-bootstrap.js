// =============================================================
// sidebar-bootstrap.js — تهيئة تلقائية للقائمة الجانبية الديناميكية
// =============================================================
// يُضاف هذا الملف لأي صفحة HTML لتعمل القائمة الجانبية الديناميكية
// تلقائيًا بدون تعديل كود الصفحة.
//
// الاستخدام في HTML:
//   <script type="module" src="assets/js/sidebar-bootstrap.js"></script>
// =============================================================

import { auth } from './firebase-config.js';
import { onAuthStateChanged } from 'firebase/auth';
import { initPermissions, stopPermissions, getUserData } from './permissions.js';
import { initDynamicSidebar, renderSidebar } from './sidebar.js';

let initialized = false;

onAuthStateChanged(auth, (user) => {
  if (user) {
    // تهيئة الصلاحيات
    initPermissions(user);

    // انتظار تحميل بيانات المستخدم ثم عرض القائمة
    const tryRender = () => {
      const userData = getUserData();
      if (userData) {
        if (!initialized) {
          initialized = true;
          initDynamicSidebar();
        } else {
          // إعادة العرض عند تحديث الصلاحيات
          renderSidebar(window.location.pathname.split('/').pop() || 'dashboard.html');
        }
      } else {
        // المحاولة مرة أخرى بعد 200ms
        setTimeout(tryRender, 200);
      }
    };

    // ابدأ المحاولة بعد فترة قصيرة لتهيئة الصلاحيات
    setTimeout(tryRender, 300);

    // استمع لتحديثات الصلاحيات لإعادة عرض القائمة
    window.addEventListener('permissionsUpdated', () => {
      renderSidebar(window.location.pathname.split('/').pop() || 'dashboard.html');
    });
  } else {
    initialized = false;
    stopPermissions();
  }
});

// الوضع المظلم (يعمل في كل الصفحات)
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

  // إزالة المستمعين السابقين وإضافة جديد
  if (themeToggle) {
    const newToggle = themeToggle.cloneNode(true);
    themeToggle.parentNode.replaceChild(newToggle, themeToggle);
    newToggle.addEventListener('click', function () {
      const current = htmlElement.getAttribute('data-theme');
      if (current === 'dark') {
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

// زر القائمة للجوال
function initMobileSidebar() {
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  if (sidebarToggle && sidebar) {
    const newToggle = sidebarToggle.cloneNode(true);
    sidebarToggle.parentNode.replaceChild(newToggle, sidebarToggle);
    newToggle.addEventListener('click', () => {
      sidebar.classList.toggle('active');
      overlay?.classList.toggle('active');
    });
  }

  if (overlay) {
    const newOverlay = overlay.cloneNode(true);
    overlay.parentNode.replaceChild(newOverlay, overlay);
    newOverlay.addEventListener('click', () => {
      sidebar?.classList.remove('active');
      newOverlay.classList.remove('active');
    });
  }
}

// تهيئة فورية (بدون انتظار المصادقة)
initDarkMode();
initMobileSidebar();

// تحديث بيانات المستخدم في القائمة عند توفرها
onAuthStateChanged(auth, (user) => {
  if (!user) return;

  const sidebarUserName = document.getElementById('sidebarUserName');
  const sidebarUserEmail = document.getElementById('sidebarUserEmail');
  const sidebarAvatar = document.getElementById('sidebarAvatar');

  if (sidebarUserName) sidebarUserName.textContent = user.displayName || user.email;
  if (sidebarUserEmail) sidebarUserEmail.textContent = user.email;
  if (sidebarAvatar) {
    sidebarAvatar.textContent = user.displayName
      ? user.displayName.charAt(0).toUpperCase()
      : user.email.charAt(0).toUpperCase();
  }
});

console.log('✅ sidebar-bootstrap.js loaded — dynamic sidebar auto-init');
