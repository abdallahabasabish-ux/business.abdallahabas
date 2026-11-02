// =============================================================
// notifications.js — مركز الإشعارات
// =============================================================

import { auth, db } from '../firebase-config.js';
import {
  collection, query, where, orderBy, onSnapshot,
  doc, updateDoc, deleteDoc, writeBatch,
} from 'firebase/firestore';
import { initPage, escapeHtml, showToast } from '../init.js';
import { initDynamicSidebar } from '../sidebar.js';
import { getCurrentUid } from '../permissions.js';

let notifications = [];
let notifListener = null;

initPage({
  onReady: async () => {
    initDynamicSidebar();
    listenToNotifications();

    document.getElementById('markAllReadBtn')?.addEventListener('click', markAllRead);
    document.getElementById('typeFilter')?.addEventListener('change', renderNotifications);
    document.getElementById('readFilter')?.addEventListener('change', renderNotifications);
  },
});

function listenToNotifications() {
  const uid = getCurrentUid();
  if (!uid) return;

  if (notifListener) notifListener();

  const q = query(
    collection(db, 'notifications'),
    where('userId', '==', uid),
    orderBy('createdAt', 'desc')
  );

  notifListener = onSnapshot(q, (snapshot) => {
    notifications = snapshot.docs.map((d) => ({
      id: d.id, ...d.data(),
      createdAt: d.data().createdAt?.toDate?.() || d.data().createdAt || null,
    }));
    renderNotifications();
  }, (e) => { console.error(e); });
}

function renderNotifications() {
  const container = document.getElementById('notifList');
  const typeFilter = document.getElementById('typeFilter')?.value || '';
  const readFilter = document.getElementById('readFilter')?.value || '';

  let filtered = notifications;
  if (typeFilter) filtered = filtered.filter((n) => n.type === typeFilter);
  if (readFilter === 'unread') filtered = filtered.filter((n) => !n.read);
  if (readFilter === 'read') filtered = filtered.filter((n) => n.read);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="text-center py-5 text-muted">
        <i class="fas fa-bell-slash fa-3x mb-3"></i>
        <h5>لا توجد إشعارات</h5>
        <p>ستظهر هنا إشعارات الطلبات والمدفوعات والمهام</p>
      </div>
    `;
    return;
  }

  const iconMap = {
    new_order: { icon: 'fa-shopping-cart', color: '#0d6efd', bg: 'rgba(13,110,253,0.12)' },
    order_approved: { icon: 'fa-check-circle', color: '#28a745', bg: 'rgba(40,167,69,0.12)' },
    order_completed: { icon: 'fa-flag-checkered', color: '#28a745', bg: 'rgba(40,167,69,0.12)' },
    order_cancelled: { icon: 'fa-times-circle', color: '#dc3545', bg: 'rgba(220,53,69,0.12)' },
    payment_pending: { icon: 'fa-clock', color: '#ffc107', bg: 'rgba(255,193,7,0.12)' },
    payment_approved: { icon: 'fa-money-bill-wave', color: '#28a745', bg: 'rgba(40,167,69,0.12)' },
    payment_rejected: { icon: 'fa-ban', color: '#dc3545', bg: 'rgba(220,53,69,0.12)' },
    task_assigned: { icon: 'fa-tasks', color: '#17a2b8', bg: 'rgba(23,162,184,0.12)' },
    task_completed: { icon: 'fa-check-double', color: '#28a745', bg: 'rgba(40,167,69,0.12)' },
    new_message: { icon: 'fa-comment', color: '#ff6600', bg: 'rgba(255,102,0,0.12)' },
    deadline_reminder: { icon: 'fa-bell', color: '#dc3545', bg: 'rgba(220,53,69,0.12)' },
    inquiry_received: { icon: 'fa-inbox', color: '#6c757d', bg: 'rgba(108,117,125,0.12)' },
  };

  let html = '';
  for (const n of filtered) {
    const info = iconMap[n.type] || iconMap.new_message;
    const time = formatTime(n.createdAt);
    html += `
      <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}">
        <div class="d-flex align-items-start gap-3">
          <div class="notif-icon" style="background:${info.bg}; color:${info.color};">
            <i class="fas ${info.icon}"></i>
          </div>
          <div style="flex:1;">
            <div class="title">${escapeHtml(n.title || '')}</div>
            <div class="body">${escapeHtml(n.body || '')}</div>
            <div class="time mt-1">${time}</div>
          </div>
          ${!n.read ? `<button class="btn btn-sm btn-outline-primary mark-read-btn" data-id="${n.id}"><i class="fas fa-check"></i></button>` : ''}
          <button class="btn btn-sm btn-outline-danger delete-notif-btn" data-id="${n.id}"><i class="fas fa-times"></i></button>
        </div>
      </div>
    `;
  }
  container.innerHTML = html;

  container.querySelectorAll('.notif-item').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      markRead(el.dataset.id);
    });
  });
  container.querySelectorAll('.mark-read-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); markRead(btn.dataset.id); });
  });
  container.querySelectorAll('.delete-notif-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); deleteNotification(btn.dataset.id); });
  });
}

async function markRead(id) {
  try {
    await updateDoc(doc(db, 'notifications', id), { read: true });
  } catch (e) { console.warn(e); }
}

async function deleteNotification(id) {
  try {
    await deleteDoc(doc(db, 'notifications', id));
  } catch (e) { showToast('تعذّر الحذف', 'error'); }
}

async function markAllRead() {
  const unread = notifications.filter((n) => !n.read);
  if (unread.length === 0) {
    showToast('لا توجد إشعارات غير مقروءة', 'info');
    return;
  }

  try {
    const batch = writeBatch(db);
    for (const n of unread) {
      batch.update(doc(db, 'notifications', n.id), { read: true });
    }
    await batch.commit();
    showToast(`تم تعليم ${unread.length} إشعار كمقروء`, 'success');
  } catch (e) {
    showToast('تعذّر التحديث', 'error');
  }
}

function formatTime(date) {
  if (!date) return '';
  if (date.toDate) date = date.toDate();
  if (!(date instanceof Date)) date = new Date(date);
  const now = new Date();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `قبل ${mins} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `قبل ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `قبل ${days} يوم`;
  return date.toISOString().slice(0, 10);
}

console.log('✅ notifications.js loaded');
