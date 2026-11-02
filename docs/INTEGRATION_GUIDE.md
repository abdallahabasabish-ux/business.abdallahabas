# دليل التكامل — دمج التسجيل والإشعارات

يوضح هذا الدليل كيفية إضافة استدعاءات `log.*` و`createNotification` 
إلى الصفحات الموجودة لتسجيل النشاطات وإرسال الإشعارات تلقائيًا.

## المبدأ

كل عملية حساسة (اعتماد، رفض، إنشاء، حذف) يجب أن:
1. تُسجّل في `activityLogs` (للمساءلة)
2. تُنشئ إشعارًا للمستلم المعنيّ (للإشعار)

## 1. payments.js — اعتماد/رفض دفعة

### في دالة `approvePayment()`، بعد `runTransaction` الناجح:

```javascript
// في أعلى الملف، أضف الاستيراد:
import { log } from '../activity-log-helper.js';
import { createNotification } from '../notification-helper.js';

// داخل approvePayment، بعد showToast('تم اعتماد الدفعة...'):
// 1. تسجيل النشاط
await log.paymentApproved(id, payment.amount, payment.customerName || 'العميل');

// 2. إشعار العميل
if (payment.customerUid) {
  await createNotification(
    payment.customerUid,
    'payment_approved',
    'تم اعتماد دفعتك',
    `تم اعتماد دفعتك بقيمة ${formatCurrency(payment.amount)}. شكرًا لك.`,
    id
  );
}
```

### في دالة `rejectPayment()`، بعد `updateDoc`:

```javascript
// تسجيل النشاط
await log.paymentRejected(id, payment.amount, payment.customerName || 'العميل');

// إشعار العميل
if (payment.customerUid) {
  await createNotification(
    payment.customerUid,
    'payment_rejected',
    'تم رفض دفعتك',
    `لم يتم اعتماد دفعتك بقيمة ${formatCurrency(payment.amount)}. ${result.value ? 'السبب: ' + result.value : ''}`,
    id
  );
}
```

## 2. orders.js — اعتماد طلب

### في دالة `approveOrder()`، بعد `updateDoc`:

```javascript
import { log } from '../activity-log-helper.js';
import { createNotification } from '../notification-helper.js';

// بعد showToast('تم اعتماد الطلب'):
await log.orderApproved(id, order.orderNumber);

// إشعار العميل
if (order.customerUid) {
  await createNotification(
    order.customerUid,
    'order_approved',
    'تم اعتماد طلبك',
    `تم اعتماد طلبك #${order.orderNumber}. ستبدأ مرحلة التنفيذ قريبًا.`,
    id
  );
}
```

## 3. tasks.js — تعيين/اعتماد مهمة

### في دالة `saveTask()` (عند الإنشاء فقط):

```javascript
import { log } from '../activity-log-helper.js';
import { createNotification } from '../notification-helper.js';

// بعد showToast('تم إنشاء المهمة'):
if (!id) {
  // تسجيل النشاط
  await log.taskAssigned(data.taskId || null, title, 
    selectedEmps.length + ' موظف');
  
  // إشعار كل موظف مسند
  for (const empUid of selectedEmps) {
    await createNotification(
      empUid,
      'task_assigned',
      'مهمة جديدة مسندة إليك',
      `تم إسناد مهمة "${title}" إليك. افحص لوحة مهامك.`,
      null // taskId غير متاح قبل الإنشاء
    );
  }
}
```

### في دالة `approveTask()`:

```javascript
// بعد showToast('تم اعتماد المهمة'):
await log.taskCompleted(id, task.title);

// إشعار الموظفين المسندين
for (const empUid of (task.assignedEmployeeIds || [])) {
  await createNotification(
    empUid,
    'task_completed',
    'تم اعتماد مهمتك',
    `تم اعتماد مهمة "${task.title}" وتسجيل مستحقك.`,
    id
  );
}
```

## 4. expenses.js — تسجيل مصروف

### في دالة `saveExpense()`، بعد الحفظ:

```javascript
import { log } from '../activity-log-helper.js';

// بعد showToast:
await log.expenseCreated(id || null, amount, description);
```

## 5. treasury.js — إيداع/سحب

### في دالة `saveTransaction()`:

```javascript
import { log } from '../activity-log-helper.js';

// بعد addDoc:
if (type === 'deposit') {
  await log.treasuryDeposit(null, amount);
} else if (type === 'withdraw') {
  await log.treasuryWithdraw(null, amount);
}
```

## 6. settings.js — تغيير دور/صلاحيات

### في دالة `openEditRoleModal()` (داخل `.then`):

```javascript
import { log } from '../activity-log-helper.js';

// بعد updateDoc:
await log.roleChanged(uid, user.email, user.role, result.value.role);
```

### في دالة `savePermissions()`:

```javascript
// بعد updateDoc:
await log.permissionsChanged(state.currentUser.uid, state.currentUser.email);
```

## 7. customers.js — CRUD العملاء

### في `saveCustomer()`:

```javascript
import { log } from '../activity-log-helper.js';

// بعد الحفظ:
if (id) {
  await log.customerUpdated(id, name);
} else {
  await log.customerCreated(null, name);
}
```

### في `confirmDelete()`:

```javascript
// بعد deleteDoc:
await log.customerDeleted(id, customer.name);
```

## 8. inquiries.js — تحويل استفسار

### في `convertToOrder()`:

```javascript
import { log } from '../activity-log-helper.js';

// بعد تحديث الاستفسار:
await log.inquiryConverted(id, inq.customerName, orderRef.id);
```

## نمط موحّد للاستخدام

في كل ملف تريد إضافة التسجيل إليه:

```javascript
// 1. في أعلى الملف، بعد الاستيرادات الموجودة:
import { log } from '../activity-log-helper.js';
import { createNotification } from '../notification-helper.js';

// 2. في كل دالة تنفّذ عملية حساسة، بعد النجاح:
//    a. سجّل النشاط
await log.<action>(<params>);

//    b. أشعر المعنيّ
await createNotification(
  <recipientUid>,
  '<type>',
  '<title>',
  '<body>',
  <relatedRecordId>
);
```

## ملاحظات مهمة

1. **لا تُوقف العملية إذا فشل التسجيل**: الدوال `log.*` و`createNotification` تلتقط الأخطاء داخليًا وتُرجع `null` بدل رمي استثناء. العملية الرئيسية تستمر.

2. **التسجيل غير متزامن**: استخدم `await` لضمان الترتيب، لكن لا يعتمد نجاح العملية الرئيسية على نجاح التسجيل.

3. **الإشعارات اختيارية**: إذا فشل الإنشاء، المستخدم لن يفقد البيانات — فقط لن يستلم الإشعار.

4. **الأداء**: كل استدعاء `addDoc` لـ activityLogs و notifications يضيف كتابة واحدة. على Spark Plan (20K كتابة/يوم)، هذا كافٍ لنظام CRM متوسط.

5. **الأمان**: القواعد (من المرحلة 2) تضمن أن:
   - `activityLogs`: userId يجب أن يطابق currentUid (لا انتحال)
   - `notifications`: userId يحدد المستلم
   - لا تعديل ولا حذف للسجلات (append-only)
