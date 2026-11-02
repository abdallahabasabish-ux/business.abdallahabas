// =============================================================
// notification-helper.js — مساعد إنشاء الإشعارات
// =============================================================
// وحدة مشتركة تُستدعى من أي صفحة لإنشاء إشعار لمستخدم.
// تُكتب في مجموعة notifications، يقرأها المستخدم المستلم فقط.
//
// أنواع الإشعارات المدعومة:
// - new_order, order_approved, order_completed, order_cancelled
// - payment_pending, payment_approved, payment_rejected
// - task_assigned, task_completed, task_rejected
// - new_message, deadline_reminder
// - inquiry_received, inquiry_converted
// =============================================================

import { db } from './firebase-config.js';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

// =============================================================
// 1. إنشاء إشعار
// =============================================================
export async function createNotification(userId, type, title, body, relatedRecordId = null) {
  if (!userId) {
    console.warn('createNotification: userId is required');
    return null;
  }

  try {
    const docRef = await addDoc(collection(db, 'notifications'), {
      userId,
      type,
      title,
      body,
      relatedRecordId,
      read: false,
      createdAt: serverTimestamp(),
    });
    return docRef.id;
  } catch (error) {
    // لا نُوقف العملية الرئيسية إذا فشل الإشعار
    console.warn('Could not create notification:', error);
    return null;
  }
}

// =============================================================
// 2. إشعارات جاهزة (قوالب مُسبقة)
// =============================================================
export const NotificationTemplates = {
  // الطلبات
  newOrder: (customerUid, orderNumber) => ({
    userId: customerUid,
    type: 'new_order',
    title: 'تم استلام طلبك',
    body: `طلبك رقم #${orderNumber} تم استلامه وسيتم مراجعته قريبًا.`,
  }),
  orderApproved: (customerUid, orderNumber) => ({
    userId: customerUid,
    type: 'order_approved',
    title: 'تم اعتماد طلبك',
    body: `تم اعتماد طلبك #${orderNumber}. ستبدأ مرحلة التنفيذ قريبًا.`,
  }),
  orderCompleted: (customerUid, orderNumber) => ({
    userId: customerUid,
    type: 'order_completed',
    title: 'تم إكمال طلبك',
    body: `تم إكمال طلبك #${orderNumber}. شكرًا لثقتك.`,
  }),

  // المدفوعات
  paymentPending: (adminUid, customerName, amount) => ({
    userId: adminUid,
    type: 'payment_pending',
    title: 'دفعة جديدة بانتظار المراجعة',
    body: `رفع ${customerName} إثبات دفع بقيمة ${amount}. بانتظار اعتمادك.`,
  }),
  paymentApproved: (customerUid, amount) => ({
    userId: customerUid,
    type: 'payment_approved',
    title: 'تم اعتماد دفعتك',
    body: `تم اعتماد دفعتك بقيمة ${amount}. شكرًا لك.`,
  }),
  paymentRejected: (customerUid, amount, reason) => ({
    userId: customerUid,
    type: 'payment_rejected',
    title: 'تم رفض دفعتك',
    body: `لم يتم اعتماد دفعتك بقيمة ${amount}. ${reason ? 'السبب: ' + reason : ''}`,
  }),

  // المهام
  taskAssigned: (employeeUid, taskTitle) => ({
    userId: employeeUid,
    type: 'task_assigned',
    title: 'مهمة جديدة مسندة إليك',
    body: `تم إسناد مهمة "${taskTitle}" إليك. افحص لوحة مهامك.`,
  }),
  taskCompleted: (adminUid, taskTitle, employeeName) => ({
    userId: adminUid,
    type: 'task_completed',
    title: 'تم إكمال مهمة',
    body: `أكمل ${employeeName} مهمة "${taskTitle}". بانتظار اعتمادك.`,
  }),

  // الرسائل
  newMessage: (recipientUid, senderName) => ({
    userId: recipientUid,
    type: 'new_message',
    title: 'رسالة جديدة',
    body: `أرسل ${senderName} رسالة جديدة لك.`,
  }),
};

// =============================================================
// 3. إنشاء إشعار من قالب
// =============================================================
export async function notify(template, relatedRecordId = null) {
  return createNotification(
    template.userId,
    template.type,
    template.title,
    template.body,
    relatedRecordId
  );
}

// =============================================================
// 4. عدد الإشعارات غير المقروءة (لاستخدامه في شارة القائمة)
// =============================================================
export async function getUnreadCount(userId) {
  if (!userId) return 0;
  try {
    const { query, where, getDocs } = await import('firebase/firestore');
    const snap = await getDocs(query(
      collection(db, 'notifications'),
      where('userId', '==', userId),
      where('read', '==', false)
    ));
    return snap.size;
  } catch (error) {
    return 0;
  }
}

console.log('✅ notification-helper.js loaded');
