// =============================================================
// activity-log-helper.js — مساعد تسجيل النشاطات
// =============================================================
// وحدة مشتركة تُسجّل نشاطًا في activityLogs (append-only).
// القواعد (من المرحلة 2) تمنع التعديل والحذف — tamper-evident.
//
// كل عملية حساسة في النظام يجب أن تستدعي logActivity():
// - إنشاء/تعديل/حذف سجل
// - اعتماد/رفض دفعة
// - تغيير دور/صلاحيات
// - حركة خزينة
// =============================================================

import { db } from './firebase-config.js';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { getCurrentUid, getUserData } from './permissions.js';

// =============================================================
// 1. تسجيل نشاط
// =============================================================
export async function logActivity(action, relatedCollection = null, relatedRecordId = null, changeSummary = '') {
  const uid = getCurrentUid();
  if (!uid) {
    console.warn('logActivity: no authenticated user');
    return null;
  }

  const userData = getUserData();

  try {
    const docRef = await addDoc(collection(db, 'activityLogs'), {
      userId: uid,
      userRole: userData?.role || 'unknown',
      userEmail: userData?.email || '',
      userName: userData?.displayName || userData?.email || '',
      action,
      relatedCollection,
      relatedRecordId,
      changeSummary,
      timestamp: new Date().toISOString(),
      createdAt: serverTimestamp(),
    });
    return docRef.id;
  } catch (error) {
    // لا نُوقف العملية الرئيسية إذا فشل التسجيل
    console.warn('Could not log activity:', error);
    return null;
  }
}

// =============================================================
// 2. قوالب الإجراءات الجاهزة
// =============================================================
export const ActivityActions = {
  // المصادقة
  USER_LOGIN: 'user_login',
  USER_LOGOUT: 'user_logout',

  // العملاء
  CUSTOMER_CREATED: 'customer_created',
  CUSTOMER_UPDATED: 'customer_updated',
  CUSTOMER_DELETED: 'customer_deleted',

  // الطلبات
  ORDER_CREATED: 'order_created',
  ORDER_UPDATED: 'order_updated',
  ORDER_APPROVED: 'order_approved',
  ORDER_COMPLETED: 'order_completed',
  ORDER_CANCELLED: 'order_cancelled',

  // المهام
  TASK_CREATED: 'task_created',
  TASK_ASSIGNED: 'task_assigned',
  TASK_COMPLETED: 'task_completed',
  TASK_REJECTED: 'task_rejected',

  // المدفوعات
  PAYMENT_CREATED: 'payment_created',
  PAYMENT_APPROVED: 'payment_approved',
  PAYMENT_REJECTED: 'payment_rejected',

  // المصروفات
  EXPENSE_CREATED: 'expense_created',
  EXPENSE_UPDATED: 'expense_updated',
  EXPENSE_DELETED: 'expense_deleted',

  // الخزينة
  TREASURY_DEPOSIT: 'treasury_deposit',
  TREASURY_WITHDRAW: 'treasury_withdraw',

  // الاستفسارات
  INQUIRY_CREATED: 'inquiry_created',
  INQUIRY_CONVERTED: 'inquiry_converted',

  // المستخدمون
  ROLE_CHANGED: 'role_changed',
  PERMISSIONS_CHANGED: 'permissions_changed',
  USER_DISABLED: 'user_disabled',
  USER_ENABLED: 'user_enabled',

  // الإعدادات
  SETTINGS_UPDATED: 'settings_updated',

  // المراسلة
  MESSAGE_SENT: 'message_sent',
  CONVERSATION_CREATED: 'conversation_created',
};

// =============================================================
// 3. دوال مختصرة للإجراءات الشائعة
// =============================================================
export const log = {
  customerCreated: (customerId, name) =>
    logActivity(ActivityActions.CUSTOMER_CREATED, 'customers', customerId, `إنشاء عميل: ${name}`),

  customerUpdated: (customerId, name) =>
    logActivity(ActivityActions.CUSTOMER_UPDATED, 'customers', customerId, `تعديل عميل: ${name}`),

  customerDeleted: (customerId, name) =>
    logActivity(ActivityActions.CUSTOMER_DELETED, 'customers', customerId, `حذف عميل: ${name}`),

  orderCreated: (orderId, orderNumber) =>
    logActivity(ActivityActions.ORDER_CREATED, 'orders', orderId, `إنشاء طلب: #${orderNumber}`),

  orderApproved: (orderId, orderNumber) =>
    logActivity(ActivityActions.ORDER_APPROVED, 'orders', orderId, `اعتماد طلب: #${orderNumber}`),

  orderCompleted: (orderId, orderNumber) =>
    logActivity(ActivityActions.ORDER_COMPLETED, 'orders', orderId, `إكمال طلب: #${orderNumber}`),

  paymentCreated: (paymentId, amount, customerName) =>
    logActivity(ActivityActions.PAYMENT_CREATED, 'payments', paymentId, `تسجيل دفعة: ${amount} من ${customerName}`),

  paymentApproved: (paymentId, amount, customerName) =>
    logActivity(ActivityActions.PAYMENT_APPROVED, 'payments', paymentId, `اعتماد دفعة: ${amount} من ${customerName}`),

  paymentRejected: (paymentId, amount, customerName) =>
    logActivity(ActivityActions.PAYMENT_REJECTED, 'payments', paymentId, `رفض دفعة: ${amount} من ${customerName}`),

  taskAssigned: (taskId, title, employeeName) =>
    logActivity(ActivityActions.TASK_ASSIGNED, 'tasks', taskId, `تعيين مهمة: "${title}" لـ ${employeeName}`),

  taskCompleted: (taskId, title) =>
    logActivity(ActivityActions.TASK_COMPLETED, 'tasks', taskId, `إكمال مهمة: "${title}"`),

  treasuryDeposit: (txId, amount) =>
    logActivity(ActivityActions.TREASURY_DEPOSIT, 'treasury', txId, `إيداع خزينة: ${amount}`),

  treasuryWithdraw: (txId, amount) =>
    logActivity(ActivityActions.TREASURY_WITHDRAW, 'treasury', txId, `سحب خزينة: ${amount}`),

  roleChanged: (uid, email, oldRole, newRole) =>
    logActivity(ActivityActions.ROLE_CHANGED, 'users', uid, `تغيير دور ${email}: ${oldRole} → ${newRole}`),

  permissionsChanged: (uid, email) =>
    logActivity(ActivityActions.PERMISSIONS_CHANGED, 'users', uid, `تحديث صلاحيات: ${email}`),

  expenseCreated: (expenseId, amount, description) =>
    logActivity(ActivityActions.EXPENSE_CREATED, 'expenses', expenseId, `تسجيل مصروف: ${amount} - ${description}`),

  inquiryConverted: (inquiryId, customerName, orderId) =>
    logActivity(ActivityActions.INQUIRY_CONVERTED, 'inquiries', inquiryId, `تحويل استفسار: ${customerName} → طلب ${orderId}`),

  messageSent: (msgId, recipientName) =>
    logActivity(ActivityActions.MESSAGE_SENT, 'messages', msgId, `إرسال رسالة إلى: ${recipientName}`),
};

console.log('✅ activity-log-helper.js loaded');
