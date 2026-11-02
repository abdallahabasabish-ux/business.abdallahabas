// =============================================================
// messages.js — نظام المراسلة للإدارة
// =============================================================

import { auth, db } from '../firebase-config.js';
import {
  collection, addDoc, doc, updateDoc, onSnapshot, query, orderBy,
  where, getDocs, serverTimestamp,
} from 'firebase/firestore';
import { initPage, escapeHtml, showToast } from '../init.js';
import { initDynamicSidebar } from '../sidebar.js';
import { getCurrentUid, getUserData } from '../permissions.js';
import { log } from '../activity-log-helper.js';
import { createNotification, NotificationTemplates } from '../notification-helper.js';

let conversations = [];
let currentConvId = null;
let messages = [];
let convListener = null;
let msgListener = null;
let customers = [];
let orders = [];
let newConvModalInstance = null;

initPage({
  onReady: async () => {
    initDynamicSidebar();
    await loadCustomers();
    await loadOrders();
    listenToConversations();

    document.getElementById('newConvBtn')?.addEventListener('click', openNewConvModal);
    document.getElementById('createConvBtn')?.addEventListener('click', createConversation);
    document.getElementById('convSearch')?.addEventListener('input', renderConversations);

    const modalEl = document.getElementById('newConvModal');
    if (modalEl) newConvModalInstance = new bootstrap.Modal(modalEl);
  },
});

async function loadCustomers() {
  try {
    const snap = await getDocs(collection(db, 'customers'));
    customers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const select = document.getElementById('newConvCustomer');
    if (select) {
      select.innerHTML = '<option value="">اختر عميل...</option>';
      customers.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.dataset.uid = c.uid || '';
        opt.textContent = c.name;
        select.appendChild(opt);
      });
    }
  } catch (e) { console.error(e); }
}

async function loadOrders() {
  try {
    const snap = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc')));
    orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) { console.error(e); }
}

// =============================================================
// الاستماع للمحادثات (Realtime)
// =============================================================
function listenToConversations() {
  if (convListener) convListener();
  const q = query(collection(db, 'conversations'), orderBy('lastMessageAt', 'desc'));
  convListener = onSnapshot(q, (snapshot) => {
    conversations = snapshot.docs.map((d) => ({
      id: d.id, ...d.data(),
      lastMessageAt: d.data().lastMessageAt?.toDate?.() || d.data().lastMessageAt || null,
    }));
    renderConversations();
  }, (e) => { console.error(e); showToast('تعذّر تحميل المحادثات', 'error'); });
}

function renderConversations() {
  const container = document.getElementById('convList');
  const search = document.getElementById('convSearch')?.value.trim().toLowerCase() || '';

  let filtered = conversations;
  if (search) {
    filtered = conversations.filter((c) =>
      (c.customerName || '').toLowerCase().includes(search) ||
      (c.subject || '').toLowerCase().includes(search)
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = '<p class="text-muted text-center py-4">لا توجد محادثات</p>';
    return;
  }

  let html = '';
  for (const conv of filtered) {
    const isActive = conv.id === currentConvId;
    const lastTime = conv.lastMessageAt ? formatTime(conv.lastMessageAt) : '';
    html += `
      <div class="conv-item ${isActive ? 'active' : ''}" data-id="${conv.id}">
        <div class="d-flex justify-content-between">
          <span class="name">${escapeHtml(conv.customerName || 'عميل')}</span>
          <span class="time">${lastTime}</span>
        </div>
        ${conv.subject ? `<div class="text-muted small">${escapeHtml(conv.subject)}</div>` : ''}
        <div class="preview">${escapeHtml(conv.lastMessage || 'لا توجد رسائل')}</div>
      </div>
    `;
  }
  container.innerHTML = html;

  container.querySelectorAll('.conv-item').forEach((el) => {
    el.addEventListener('click', () => selectConversation(el.dataset.id));
  });
}

// =============================================================
// اختيار محادثة وعرض الرسائل
// =============================================================
function selectConversation(convId) {
  currentConvId = convId;
  renderConversations();

  if (msgListener) msgListener();

  const q = query(
    collection(db, 'messages'),
    where('conversationId', '==', convId),
    orderBy('createdAt', 'asc')
  );

  msgListener = onSnapshot(q, (snapshot) => {
    messages = snapshot.docs.map((d) => ({
      id: d.id, ...d.data(),
      createdAt: d.data().createdAt?.toDate?.() || d.data().createdAt || null,
    }));
    renderMessages();
  }, (e) => { console.error(e); });
}

function renderMessages() {
  const panel = document.getElementById('msgPanel');
  const conv = conversations.find((c) => c.id === currentConvId);
  if (!conv) return;

  const uid = getCurrentUid();

  let html = `
    <div class="msg-header">
      <strong>${escapeHtml(conv.customerName || 'عميل')}</strong>
      ${conv.subject ? `<div class="text-muted small">${escapeHtml(conv.subject)}</div>` : ''}
    </div>
    <div class="msg-body" id="msgBody">
  `;

  if (messages.length === 0) {
    html += '<p class="text-muted text-center py-4">لا توجد رسائل بعد. ابدأ المحادثة!</p>';
  } else {
    for (const msg of messages) {
      const isSent = msg.senderUid === uid;
      const cls = isSent ? 'msg-sent' : 'msg-received';
      const senderName = isSent ? 'أنت' : (msg.senderName || 'العميل');
      const time = msg.createdAt ? formatTime(msg.createdAt) : '';

      html += `
        <div class="msg-bubble ${cls}">
          <div>${escapeHtml(msg.text)}</div>
          ${msg.attachmentUrl ? `<a href="${msg.attachmentUrl}" target="_blank" class="text-light small"><i class="fas fa-paperclip"></i> مرفق</a>` : ''}
          <div class="msg-time">${senderName} • ${time}</div>
        </div>
      `;
    }
  }

  html += `</div>
    <div class="msg-input">
      <div class="d-flex gap-2">
        <input type="text" class="form-control" id="msgInput" placeholder="اكتب رسالتك..." />
        <button class="btn btn-primary" id="sendMsgBtn"><i class="fas fa-paper-plane"></i></button>
      </div>
    </div>
  `;

  panel.innerHTML = html;

  // تمرير للأسفل
  const body = document.getElementById('msgBody');
  if (body) body.scrollTop = body.scrollHeight;

  // إرسال
  document.getElementById('sendMsgBtn')?.addEventListener('click', sendMessage);
  document.getElementById('msgInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  // تحديث المحادثة كمقروءة
  markConversationRead(conv);
}

// =============================================================
// إرسال رسالة
// =============================================================
async function sendMessage() {
  const input = document.getElementById('msgInput');
  const text = input?.value.trim();
  if (!text || !currentConvId) return;

  const conv = conversations.find((c) => c.id === currentConvId);
  if (!conv) return;

  const uid = getCurrentUid();
  const userData = getUserData();

  input.value = '';
  input.disabled = true;

  try {
    // الحصول على participants (العميل + الموظف)
    const participants = [conv.customerUid, uid].filter(Boolean);

    await addDoc(collection(db, 'messages'), {
      conversationId: currentConvId,
      senderUid: uid,
      senderRole: userData?.role || 'admin',
      senderName: userData?.displayName || userData?.email || 'إدارة',
      text,
      attachmentUrl: null,
      participants,
      readAt: null,
      createdAt: serverTimestamp(),
    });

    // تحديث آخر رسالة في المحادثة
    await updateDoc(doc(db, 'conversations', currentConvId), {
      lastMessage: text,
      lastMessageAt: serverTimestamp(),
      lastSenderUid: uid,
    });

    // إشعار العميل برسالة جديدة
    if (conv.customerUid && conv.customerUid !== uid) {
      await createNotification(
        conv.customerUid,
        'new_message',
        'رسالة جديدة من الإدارة',
        `${userData?.displayName || 'الإدارة'} أرسل رسالة جديدة لك.`,
        currentConvId
      );
    }

    // تسجيل النشاط
    await log.messageSent(null, conv.customerName || 'العميل');

    input.disabled = false;
    input.focus();
  } catch (error) {
    console.error('Error sending message:', error);
    showToast('تعذّر إرسال الرسالة', 'error');
    input.disabled = false;
    input.value = text;
  }
}

// =============================================================
// تحديث المحادثة كمقروءة
// =============================================================
async function markConversationRead(conv) {
  // تحديث الرسائل غير المقروءة الموجَّهة للمستخدم الحالي
  const unreadMsgs = messages.filter((m) => m.senderUid !== getCurrentUid() && !m.readAt);
  if (unreadMsgs.length === 0) return;

  try {
    const batch = [];
    for (const msg of unreadMsgs) {
      batch.push(updateDoc(doc(db, 'messages', msg.id), {
        readAt: new Date().toISOString(),
      }));
    }
    await Promise.all(batch);
  } catch (e) { console.warn(e); }
}

// =============================================================
// محادثة جديدة
// =============================================================
function openNewConvModal() {
  // تعبئة قائمة الطلبات
  const orderSelect = document.getElementById('newConvOrder');
  if (orderSelect) {
    orderSelect.innerHTML = '<option value="">بدون طلب</option>';
    orders.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.id;
      opt.textContent = `#${o.orderNumber || 'N/A'} — ${o.notes || 'طلب'}`;
      orderSelect.appendChild(opt);
    });
  }

  document.getElementById('newConvSubject').value = '';
  document.getElementById('newConvMessage').value = '';
  if (newConvModalInstance) newConvModalInstance.show();
}

async function createConversation() {
  const customerId = document.getElementById('newConvCustomer').value;
  const subject = document.getElementById('newConvSubject').value.trim();
  const message = document.getElementById('newConvMessage').value.trim();
  const orderId = document.getElementById('newConvOrder').value;

  if (!customerId || !message) {
    showToast('اختر عميلًا واكتب رسالة', 'warning');
    return;
  }

  const customer = customers.find((c) => c.id === customerId);
  if (!customer) {
    showToast('العميل غير موجود', 'error');
    return;
  }

  const uid = getCurrentUid();
  const userData = getUserData();
  const btn = document.getElementById('createConvBtn');

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>جاري...';

  try {
    // إنشاء المحادثة
    const convRef = await addDoc(collection(db, 'conversations'), {
      customerId,
      customerUid: customer.uid || null,
      customerName: customer.name,
      employeeUid: uid,
      employeeName: userData?.displayName || userData?.email || 'إدارة',
      subject: subject || `محادثة مع ${customer.name}`,
      orderId: orderId || null,
      status: 'active',
      lastMessage: message,
      lastMessageAt: serverTimestamp(),
      lastSenderUid: uid,
      createdAt: serverTimestamp(),
      updatedAt: new Date().toISOString(),
    });

    // إرسال الرسالة الأولى
    const participants = [customer.uid, uid].filter(Boolean);
    await addDoc(collection(db, 'messages'), {
      conversationId: convRef.id,
      senderUid: uid,
      senderRole: userData?.role || 'admin',
      senderName: userData?.displayName || userData?.email || 'إدارة',
      text: message,
      attachmentUrl: null,
      participants,
      readAt: null,
      createdAt: serverTimestamp(),
    });

    // إشعار العميل
    if (customer.uid) {
      await createNotification(
        customer.uid,
        'new_message',
        'رسالة جديدة من الإدارة',
        `${userData?.displayName || 'الإدارة'} بدأ محادثة جديدة معك.`,
        convRef.id
      );
    }

    // تسجيل النشاط
    await log.messageSent(null, customer.name);

    showToast('تم إنشاء المحادثة وإرسال الرسالة', 'success');
    if (newConvModalInstance) newConvModalInstance.hide();
    selectConversation(convRef.id);
  } catch (error) {
    console.error('Error creating conversation:', error);
    showToast('تعذّر إنشاء المحادثة: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane me-2"></i>إنشاء وإرسال';
  }
}

// =============================================================
// مساعدات
// =============================================================
function formatTime(date) {
  if (!date) return '';
  if (date.toDate) date = date.toDate();
  if (!(date instanceof Date)) date = new Date(date);
  const now = new Date();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `${mins} د`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} س`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ي`;
  return date.toISOString().slice(0, 10);
}

console.log('✅ messages.js loaded');
