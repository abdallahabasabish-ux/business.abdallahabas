// =============================================================
// sidebar.js — مُحدَّث مع المراسلة والإشعارات وسجل النشاطات
// =============================================================

import {
  isAdmin, isAccountant, hasPermission, getUserData,
} from './permissions.js';
import { escapeHtml } from './init.js';
import { getUnreadCount } from './notification-helper.js';

const MENU_SECTIONS = [
  {
    label: 'الرئيسية',
    items: [
      { href: 'dashboard.html', icon: '<svg viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>', label: 'لوحة القيادة', permission: null },
      { href: 'analytics.html', icon: '<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>', label: 'التحليلات', permission: 'canViewReports' },
      { href: 'notifications.html', icon: '<svg viewBox="0 0 24 24"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>', label: 'الإشعارات', permission: null, badge: true },
    ],
  },
  {
    label: 'إدارة الأعمال',
    items: [
      { href: 'customers.html', icon: '<svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>', label: 'العملاء', permission: 'canViewCustomers' },
      { href: 'inquiries.html', icon: '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>', label: 'الاستفسارات', permission: 'canViewInquiries' },
      { href: 'orders.html', icon: '<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>', label: 'الطلبات', permission: 'canViewOrders' },
      { href: 'services.html', icon: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>', label: 'الخدمات', permission: null },
    ],
  },
  {
    label: 'الموظفون',
    items: [
      { href: 'employees.html', icon: '<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>', label: 'الموظفون', permission: 'canViewEmployees' },
      { href: 'tasks.html', icon: '<svg viewBox="0 0 24 24"><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm-2 14l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>', label: 'المهام', permission: 'canViewTasks' },
      { href: 'employee-ledger.html', icon: '<svg viewBox="0 0 24 24"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>', label: 'مستحقات الموظفين', permission: 'canViewPayments' },
    ],
  },
  {
    label: 'المالية',
    items: [
      { href: 'invoices.html', icon: '<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/></svg>', label: 'الفواتير', permission: 'canViewInvoices' },
      { href: 'payments.html', icon: '<svg viewBox="0 0 24 24"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>', label: 'المدفوعات', permission: 'canViewPayments' },
      { href: 'expenses.html', icon: '<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>', label: 'المصروفات', permission: 'canViewPayments' },
      { href: 'treasury.html', icon: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>', label: 'الخزينة', permission: 'canViewTreasury' },
      { href: 'profit-loss.html', icon: '<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>', label: 'الأرباح والخسائر', permission: 'canViewReports' },
    ],
  },
  {
    label: 'التواصل',
    items: [
      { href: 'messages.html', icon: '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>', label: 'المراسلة', permission: null },
    ],
  },
  {
    label: 'التقارير',
    items: [
      { href: 'reports.html', icon: '<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>', label: 'تقارير الأعمال', permission: 'canViewReports' },
    ],
  },
  {
    label: 'النظام',
    items: [
      { href: 'activity-logs.html', icon: '<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14H7v-2h5v2zm5-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>', label: 'سجل النشاطات', permission: null, adminOnly: true },
      { href: 'payment-methods.html', icon: '<svg viewBox="0 0 24 24"><path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2z"/></svg>', label: 'طرق الدفع', permission: null, adminOnly: true },
      { href: 'settings.html', icon: '<svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .43-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.49-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>', label: 'الإعدادات', permission: null },
    ],
  },
];

export function renderSidebar(activePage) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const userData = getUserData();
  const userName = userData?.email || userData?.displayName || 'المستخدم';
  const userInitial = (userName.charAt(0) || 'م').toUpperCase();
  const roleLabel = userData?.role || 'موظف';
  const uid = userData?.uid;

  let html = `<div class="sidebar-header"><div class="logo-icon">ن</div><div class="brand-text">نظام <span>الإدارة</span></div></div><ul class="sidebar-menu">`;

  for (const section of MENU_SECTIONS) {
    const visibleItems = section.items.filter((item) => {
      if (item.adminOnly && !isAdmin()) return false;
      if (!item.permission) return true;
      return isAdmin() || hasPermission(item.permission);
    });
    if (visibleItems.length === 0) continue;

    html += `<li class="menu-label">${escapeHtml(section.label)}</li>`;
    for (const item of visibleItems) {
      const isActive = activePage === item.href;
      const badgeAttr = item.badge ? ` data-badge="true"` : '';
      html += `<li><a href="${item.href}" class="menu-item ${isActive ? 'active' : ''}"${badgeAttr}>${item.icon} ${escapeHtml(item.label)}</a></li>`;
    }
  }

  html += `</ul>
    <div class="sidebar-footer">
      <div class="user-card">
        <div class="user-avatar" id="sidebarAvatar">${userInitial}</div>
        <div>
          <div class="user-name" id="sidebarUserName">${escapeHtml(userName)}</div>
          <div class="user-email" id="sidebarUserEmail">${escapeHtml(userData?.email || '')}</div>
          <span class="badge bg-secondary mt-1" id="sidebarRoleBadge" style="font-size:11px;">${escapeHtml(roleLabel)}</span>
        </div>
      </div>
    </div>`;

  sidebar.innerHTML = html;

  // تحديث شارة الإشعارات
  if (uid) {
    updateNotificationBadge(uid);
  }
}

// تحديث شارة الإشعارات غير المقروءة
async function updateNotificationBadge(uid) {
  try {
    const count = await getUnreadCount(uid);
    const notifLink = document.querySelector('a[href="notifications.html"]');
    if (!notifLink) return;

    // إزالة الشارة القديمة
    const oldBadge = notifLink.querySelector('.notif-count');
    if (oldBadge) oldBadge.remove();

    if (count > 0) {
      const badge = document.createElement('span');
      badge.className = 'notif-count';
      badge.style.cssText = 'position:absolute; top:-2px; left:-2px; background:#dc3545; color:#fff; font-size:10px; font-weight:700; border-radius:10px; padding:2px 6px; min-width:18px; text-align:center;';
      badge.textContent = count > 99 ? '99+' : count;
      notifLink.style.position = 'relative';
      notifLink.appendChild(badge);
    }
  } catch (e) {
    // تجاهل الأخطاء
  }
}

let currentPageTracker = null;

export function initDynamicSidebar() {
  currentPageTracker = getCurrentPageName();
  renderSidebar(currentPageTracker);
  window.addEventListener('permissionsUpdated', () => {
    renderSidebar(currentPageTracker);
  });

  // تحديث الشارة كل 30 ثانية
  setInterval(() => {
    const userData = getUserData();
    if (userData?.uid) {
      updateNotificationBadge(userData.uid);
    }
  }, 30000);
}

function getCurrentPageName() {
  const path = window.location.pathname;
  return path.split('/').pop() || 'dashboard.html';
}

console.log('✅ sidebar.js loaded (updated with messages, notifications, activity-logs)');
