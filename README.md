# نظام إدارة الأعمال CRM — النسخة الكاملة المُرقّاة

## نظرة عامة
نظام CRM متكامل بُني على Firebase Spark Plan (مجاني بالكامل).
يدعم 5 أنواع مستخدمين: مدير، محاسب، مشرف، موظف، عميل.

## التركيب السريع

### 1. انسخ ملفات التكوين
ملفات firestore.rules, firestore.indexes.json, storage.rules, firebase.json, .firebaserc موجودة في جذر المشروع.

### 2. انشر على Firebase
```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only storage
```

### 3. إعداد المدير الأول
```bash
cd scripts
npm install firebase-admin
# نزّل service-account.json من Firebase Console
node set-admin.js your@email.com
```

### 4. اختبار
- افتح index.html → سجّل دخول كمدير
- افتح portal-login.html → أنشئ حساب عميل
- اختبر قائمة القبول في docs/TESTING_CHECKLIST.md

## الوثائق
- docs/BACKUP_PROCEDURE.md — النسخ الاحتياطي
- docs/TESTING_CHECKLIST.md — قائمة الاختبار
- docs/INTEGRATION_GUIDE.md — دمج التسجيل والإشعارات
- docs/README-Phase*.md — أدلة كل مرحلة

## الصفحات (27 صفحة)
### لوحة الإدارة
dashboard, analytics, customers, inquiries, orders, services,
employees, tasks, employee-ledger, invoices, payments, expenses,
treasury, profit-loss, reports, messages, notifications,
activity-logs, payment-methods, settings

### بوابة العميل
portal-login, portal-dashboard, portal-orders, portal-payments

### لوحة الموظف
employee-dashboard

## المجموعات (17)
customers, employees, services, orders, payments, invoices,
treasury, users, settings (أصلية)
tasks, inquiries, conversations, messages, notifications,
employeeLedger, activityLogs, paymentMethods, systemSettings (جديدة)

## الميزانية: 0 دولار
كل شيء على Firebase Spark Plan المجاني.
